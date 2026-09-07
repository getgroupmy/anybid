/**
 * AnyBid has four consoles. A single account can hold several roles at once —
 * a corporate buyer who also advertises is one login, three consoles.
 */
export const ROLES = [
  'USER', // buyer + seller — the default marketplace account
  'ADVERTISER', // ad campaigns, creatives, billing
  'CORPORATE', // organisation seat: procurement, approvals, team
  'ADMIN', // platform operations
  'SUPER_ADMIN', // everything, including admin management
] as const;

export type Role = (typeof ROLES)[number];

/** Seat level inside a corporate organisation. */
export const ORG_ROLES = ['OWNER', 'ADMIN', 'APPROVER', 'BUYER', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  // marketplace
  'listing:create',
  'listing:update:own',
  'listing:moderate',
  'bid:place',
  'order:view:own',
  'order:manage:all',
  // advertiser
  'campaign:manage:own',
  'campaign:manage:all',
  'ads:report',
  // corporate
  'org:manage',
  'org:members:manage',
  'org:approve',
  'org:budget:manage',
  'org:invoice:view',
  // admin
  'user:manage',
  'user:suspend',
  'kyc:review',
  'dispute:resolve',
  'settings:manage',
  'audit:read',
  'admin:manage',
  'payout:release',
  'metrics:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const USER_PERMS: Permission[] = [
  'listing:create',
  'listing:update:own',
  'bid:place',
  'order:view:own',
];

const ADVERTISER_PERMS: Permission[] = ['campaign:manage:own', 'ads:report'];

const CORPORATE_PERMS: Permission[] = [
  ...USER_PERMS,
  'org:invoice:view',
];

const ADMIN_PERMS: Permission[] = [
  'listing:moderate',
  'order:manage:all',
  'campaign:manage:all',
  'ads:report',
  'user:manage',
  'user:suspend',
  'kyc:review',
  'dispute:resolve',
  'settings:manage',
  'audit:read',
  'payout:release',
  'metrics:read',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  USER: USER_PERMS,
  ADVERTISER: ADVERTISER_PERMS,
  CORPORATE: CORPORATE_PERMS,
  ADMIN: ADMIN_PERMS,
  SUPER_ADMIN: [...PERMISSIONS],
};

/** Permissions granted by a seat inside an organisation, on top of role perms. */
export const ORG_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  OWNER: ['org:manage', 'org:members:manage', 'org:approve', 'org:budget:manage', 'org:invoice:view'],
  ADMIN: ['org:members:manage', 'org:approve', 'org:budget:manage', 'org:invoice:view'],
  APPROVER: ['org:approve', 'org:invoice:view'],
  BUYER: ['bid:place', 'order:view:own'],
  VIEWER: [],
};

export interface Principal {
  id: string;
  roles: Role[];
  orgId?: string | null;
  orgRole?: OrgRole | null;
}

export function permissionsFor(principal: Pick<Principal, 'roles' | 'orgRole'>): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of principal.roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  if (principal.orgRole) for (const p of ORG_ROLE_PERMISSIONS[principal.orgRole]) out.add(p);
  return out;
}

export function can(
  principal: Pick<Principal, 'roles' | 'orgRole'>,
  permission: Permission,
): boolean {
  return permissionsFor(principal).has(permission);
}

export function hasRole(principal: Pick<Principal, 'roles'>, ...roles: Role[]): boolean {
  return roles.some((r) => principal.roles.includes(r));
}

export function isAdmin(principal: Pick<Principal, 'roles'>): boolean {
  return hasRole(principal, 'ADMIN', 'SUPER_ADMIN');
}

/** Which consoles the navigation should offer this principal. */
export interface ConsoleEntry {
  key: 'user' | 'admin' | 'advertiser' | 'corporate';
  label: string;
  path: string;
}

export function consolesFor(principal: Pick<Principal, 'roles' | 'orgId'>): ConsoleEntry[] {
  const out: ConsoleEntry[] = [
    { key: 'user', label: 'My Account', path: '/account' },
  ];
  if (principal.roles.includes('ADVERTISER'))
    out.push({ key: 'advertiser', label: 'Advertiser Console', path: '/advertiser' });
  if (principal.roles.includes('CORPORATE') || principal.orgId)
    out.push({ key: 'corporate', label: 'Corporate Console', path: '/corporate' });
  if (isAdmin(principal as Principal))
    out.push({ key: 'admin', label: 'Admin Console', path: '/admin' });
  return out;
}
