/**
 * Seeds a believable AnyBid marketplace: categories, users for every console,
 * live auctions mid-bidding, closed sales, ad campaigns and a corporate team.
 *
 * Every demo account uses the password `Password123`.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto.ts';
import { placeBidForUser } from '../src/services/bidding.ts';
import { settleListing } from '../src/services/settlement.ts';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const CATEGORIES: { name: string; slug: string; icon: string; children: [string, string][] }[] = [
  {
    name: 'Electronics',
    slug: 'electronics',
    icon: '📱',
    children: [
      ['Mobile Phones', 'mobile-phones'],
      ['Laptops & Computers', 'laptops-computers'],
      ['Cameras', 'cameras'],
      ['Audio & Headphones', 'audio-headphones'],
      ['Gaming', 'gaming'],
    ],
  },
  {
    name: 'Vehicles',
    slug: 'vehicles',
    icon: '🚗',
    children: [
      ['Cars', 'cars'],
      ['Motorcycles', 'motorcycles'],
      ['Car Accessories', 'car-accessories'],
    ],
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    icon: '👜',
    children: [
      ['Watches', 'watches'],
      ['Bags & Luggage', 'bags-luggage'],
      ['Sneakers', 'sneakers'],
      ['Jewellery', 'jewellery'],
    ],
  },
  {
    name: 'Home & Living',
    slug: 'home-living',
    icon: '🛋️',
    children: [
      ['Furniture', 'furniture'],
      ['Home Appliances', 'home-appliances'],
      ['Kitchenware', 'kitchenware'],
    ],
  },
  {
    name: 'Collectibles',
    slug: 'collectibles',
    icon: '🏆',
    children: [
      ['Trading Cards', 'trading-cards'],
      ['Coins & Stamps', 'coins-stamps'],
      ['Art & Antiques', 'art-antiques'],
    ],
  },
  {
    name: 'Industrial & Business',
    slug: 'industrial-business',
    icon: '🏭',
    children: [
      ['Heavy Machinery', 'heavy-machinery'],
      ['Office Equipment', 'office-equipment'],
      ['Bulk & Wholesale', 'bulk-wholesale'],
    ],
  },
];

const STATES = ['Selangor', 'Kuala Lumpur', 'Penang', 'Johor', 'Sabah', 'Sarawak', 'Perak'];

/** Deterministic placeholder imagery — no external asset pipeline needed. */
function img(seed: string, w = 800, h = 600): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

interface SeedUser {
  email: string;
  displayName: string;
  handle: string;
  roles: Prisma.UserCreateInput['roles'];
  city?: string;
  state?: string;
  verified?: boolean;
  accountType?: 'PERSONAL' | 'BUSINESS';
}

const USERS: SeedUser[] = [
  { email: 'admin@anybid.my', displayName: 'AnyBid Admin', handle: 'anybidadmin', roles: ['USER', 'ADMIN', 'SUPER_ADMIN'], verified: true, city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
  { email: 'ops@anybid.my', displayName: 'Nurul Ops', handle: 'nurulops', roles: ['USER', 'ADMIN'], verified: true, city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
  { email: 'aisha@example.com', displayName: 'Aisha Rahman', handle: 'aisharahman', roles: ['USER'], verified: true, city: 'Shah Alam', state: 'Selangor' },
  { email: 'daniel@example.com', displayName: 'Daniel Tan', handle: 'danieltan', roles: ['USER'], verified: true, city: 'George Town', state: 'Penang' },
  { email: 'siti@example.com', displayName: 'Siti Nurhaliza', handle: 'sitin', roles: ['USER'], city: 'Johor Bahru', state: 'Johor' },
  { email: 'raj@example.com', displayName: 'Rajesh Kumar', handle: 'rajeshk', roles: ['USER'], verified: true, city: 'Ipoh', state: 'Perak' },
  { email: 'mei@example.com', displayName: 'Mei Ling Wong', handle: 'meiling', roles: ['USER'], city: 'Kuching', state: 'Sarawak' },
  { email: 'faiz@example.com', displayName: 'Faiz Abdullah', handle: 'faizab', roles: ['USER'], city: 'Kota Kinabalu', state: 'Sabah' },
  { email: 'advertiser@brandco.my', displayName: 'BrandCo Marketing', handle: 'brandco', roles: ['USER', 'ADVERTISER'], accountType: 'BUSINESS', verified: true, city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
  { email: 'ads@techstore.my', displayName: 'TechStore Ads', handle: 'techstoreads', roles: ['USER', 'ADVERTISER'], accountType: 'BUSINESS', verified: true, city: 'Petaling Jaya', state: 'Selangor' },
  { email: 'procurement@megacorp.my', displayName: 'Lim Wei Sheng', handle: 'limweisheng', roles: ['USER', 'CORPORATE'], accountType: 'BUSINESS', verified: true, city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
  { email: 'buyer1@megacorp.my', displayName: 'Hafiz Ismail', handle: 'hafizismail', roles: ['USER', 'CORPORATE'], accountType: 'BUSINESS', city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
  { email: 'buyer2@megacorp.my', displayName: 'Grace Chong', handle: 'gracechong', roles: ['USER', 'CORPORATE'], accountType: 'BUSINESS', city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
  { email: 'finance@megacorp.my', displayName: 'Kamala Devi', handle: 'kamaladevi', roles: ['USER', 'CORPORATE'], accountType: 'BUSINESS', city: 'Kuala Lumpur', state: 'Kuala Lumpur' },
];

interface SeedListing {
  title: string;
  description: string;
  categorySlug: string;
  sellerHandle: string;
  kind: 'AUCTION' | 'BUY_NOW' | 'AUCTION_WITH_BUY_NOW';
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS' | 'REFURBISHED';
  startPrice: number;
  reservePrice?: number;
  buyNowPrice?: number;
  /** hours from now; negative means the auction already closed */
  endsInHours: number;
  tags: string[];
  featured?: boolean;
  /** proxy maximums to simulate, in order */
  bids?: { handle: string; max: number }[];
}

const LISTINGS: SeedListing[] = [
  {
    title: 'iPhone 15 Pro Max 256GB Natural Titanium — Malaysia Set',
    description:
      'Bought from a Malaysian authorised reseller in March. Battery health 98%, no scratches, always in a case with a screen protector on since day one.\n\nComes with the original box, unused USB-C cable and the receipt for warranty purposes. Selling because I switched to a work-issued phone.\n\nMeet-up available around Shah Alam and Subang, or I can post it out with tracking the same day payment clears.',
    categorySlug: 'mobile-phones',
    sellerHandle: 'aisharahman',
    kind: 'AUCTION_WITH_BUY_NOW',
    condition: 'LIKE_NEW',
    startPrice: 2_500_00,
    reservePrice: 3_800_00,
    buyNowPrice: 5_200_00,
    endsInHours: 8,
    featured: true,
    tags: ['iphone', 'apple', 'smartphone'],
    bids: [
      { handle: 'danieltan', max: 3_200_00 },
      { handle: 'rajeshk', max: 3_900_00 },
      { handle: 'sitin', max: 4_150_00 },
      { handle: 'meiling', max: 4_400_00 },
    ],
  },
  {
    title: 'MacBook Pro 14" M3 Pro 18GB / 512GB — AppleCare until 2027',
    description:
      'Developer machine, three months old, still under AppleCare+ until March 2027. 14-inch M3 Pro with 18GB unified memory and a 512GB SSD.\n\n47 charge cycles. Never opened, never repaired. Includes the 96W adapter and the original packaging.\n\nUpgrading to the M4 Max, which is the only reason this is going. Happy to demo it before you bid.',
    categorySlug: 'laptops-computers',
    sellerHandle: 'danieltan',
    kind: 'AUCTION',
    condition: 'LIKE_NEW',
    startPrice: 4_000_00,
    reservePrice: 6_500_00,
    endsInHours: 26,
    featured: true,
    tags: ['macbook', 'apple', 'laptop'],
    bids: [
      { handle: 'aisharahman', max: 5_500_00 },
      { handle: 'faizab', max: 6_800_00 },
      { handle: 'rajeshk', max: 7_200_00 },
    ],
  },
  {
    title: 'Rolex Submariner Date 126610LN — 2022, Full Set',
    description:
      'Complete set: box, papers, tags, and the original purchase receipt from an authorised dealer in Kuala Lumpur, dated August 2022.\n\nWorn perhaps a dozen times. No polishing, no service history needed yet. Bracelet has all links.\n\nReserve is set and it is firm. Serious bidders only — I am happy to meet at a bank or a jeweller of your choosing for the handover, and authentication before payment is welcome.',
    categorySlug: 'watches',
    sellerHandle: 'rajeshk',
    kind: 'AUCTION',
    condition: 'LIKE_NEW',
    startPrice: 20_000_00,
    reservePrice: 42_000_00,
    endsInHours: 70,
    featured: true,
    tags: ['rolex', 'submariner', 'luxury'],
    bids: [
      { handle: 'limweisheng', max: 35_000_00 },
      { handle: 'danieltan', max: 44_000_00 },
    ],
  },
  {
    title: 'Sony A7 IV Body + 28-70mm Kit Lens — 11k Shutter Count',
    description:
      'Full-frame workhorse in excellent condition. Shutter count 11,240, verified and I will show you the read-out.\n\nIncludes two genuine Sony NP-FZ100 batteries, a dual charger, a 128GB Sony Tough SD card and the kit lens. Small mark on the base plate from a tripod plate, nothing that affects use.\n\nSelling my whole Sony kit as I have moved to medium format for work.',
    categorySlug: 'cameras',
    sellerHandle: 'meiling',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 3_000_00,
    endsInHours: 4,
    tags: ['sony', 'camera', 'mirrorless'],
    bids: [
      { handle: 'sitin', max: 3_800_00 },
      { handle: 'aisharahman', max: 4_600_00 },
      { handle: 'faizab', max: 4_800_00 },
      { handle: 'danieltan', max: 5_400_00 },
      { handle: 'rajeshk', max: 5_500_00 },
    ],
  },
  {
    title: 'Perodua Myvi 1.5 AV 2019 — 62,000km, One Owner',
    description:
      'Single-owner Myvi AV, full service history at the Perodua service centre, last serviced at 60,000km.\n\nNo accidents, no flood damage. Original paint throughout. Tyres replaced in January, brake pads done at the same time. ASA 2.0 works as it should.\n\nRoad tax valid until June. Loan can be arranged through a panel bank. Viewing in Ipoh, weekdays after 6pm or any time on weekends.',
    categorySlug: 'cars',
    sellerHandle: 'rajeshk',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 25_000_00,
    reservePrice: 34_000_00,
    endsInHours: 96,
    tags: ['perodua', 'myvi', 'car'],
    bids: [
      { handle: 'faizab', max: 31_000_00 },
      { handle: 'meiling', max: 33_500_00 },
    ],
  },
  {
    title: 'Herman Miller Aeron Remastered Size B — Graphite',
    description:
      'Genuine Herman Miller Aeron, remastered model, size B in graphite with the standard tilt. Bought in 2021 for a home office that I no longer use.\n\nPosturefit SL intact, all functions smooth, gas lift holds perfectly. Mesh is clean with no sagging.\n\nWill be dismantled for courier or you can collect it assembled from Kuching.',
    categorySlug: 'furniture',
    sellerHandle: 'meiling',
    kind: 'AUCTION_WITH_BUY_NOW',
    condition: 'GOOD',
    startPrice: 1_200_00,
    buyNowPrice: 3_500_00,
    endsInHours: 44,
    tags: ['herman miller', 'chair', 'office'],
    bids: [
      { handle: 'danieltan', max: 1_800_00 },
      { handle: 'gracechong', max: 2_100_00 },
    ],
  },
  {
    title: 'Nintendo Switch OLED + 6 Games Bundle',
    description:
      'White OLED model with a 256GB microSD already installed. Joy-Cons have no drift — I test them before every listing I make.\n\nBundle includes Zelda: Tears of the Kingdom, Mario Kart 8 Deluxe, Metroid Dread, Fire Emblem Engage, Splatoon 3 and Super Mario Odyssey, all physical carts in their cases.\n\nEverything works. Dock, cables and the original box are included.',
    categorySlug: 'gaming',
    sellerHandle: 'faizab',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 800_00,
    endsInHours: 2,
    tags: ['nintendo', 'switch', 'console'],
    bids: [
      { handle: 'sitin', max: 1_100_00 },
      { handle: 'meiling', max: 1_250_00 },
      { handle: 'aisharahman', max: 1_400_00 },
    ],
  },
  {
    title: 'Sennheiser HD 800 S Reference Headphones',
    description:
      'The reference open-back, in excellent condition with the original box, both cables (6.3mm and balanced XLR-4) and the certificate.\n\nPads were replaced with genuine Sennheiser parts six months ago. No cracks in the headband, no cosmetic issues.\n\nThese need a proper amp to sing. Collection in Kota Kinabalu or insured postage nationwide.',
    categorySlug: 'audio-headphones',
    sellerHandle: 'faizab',
    kind: 'AUCTION',
    condition: 'LIKE_NEW',
    startPrice: 2_000_00,
    reservePrice: 4_500_00,
    endsInHours: 52,
    tags: ['sennheiser', 'headphones', 'audiophile'],
    bids: [{ handle: 'rajeshk', max: 3_200_00 }],
  },
  {
    title: 'Charizard Base Set Holo PSA 8 — 1999 Unlimited',
    description:
      'PSA 8 NM-MT, cert number available on request so you can verify it on the PSA site before bidding.\n\nUnlimited print, 1999 Base Set. Centering is strong for the grade, holo is clean with no scratching under a light.\n\nStored in a card saver inside a sealed box since it came back from grading. Ships double-boxed and insured.',
    categorySlug: 'trading-cards',
    sellerHandle: 'sitin',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 3_000_00,
    reservePrice: 8_000_00,
    endsInHours: 120,
    tags: ['pokemon', 'charizard', 'psa'],
    bids: [
      { handle: 'danieltan', max: 5_500_00 },
      { handle: 'meiling', max: 7_000_00 },
      { handle: 'faizab', max: 9_500_00 },
    ],
  },
  {
    title: 'Dyson V15 Detect Absolute — Under Warranty',
    description:
      'Bought in November, still has warranty until next November with the receipt to prove it.\n\nAll attachments present including the laser fluffy head, hair screw tool and the HEPA filter. Filter washed and dried, bin cleaned.\n\nSelling because our new place came with a built-in vacuum system. Barely used, maybe fifteen times.',
    categorySlug: 'home-appliances',
    sellerHandle: 'aisharahman',
    kind: 'BUY_NOW',
    condition: 'LIKE_NEW',
    startPrice: 1_800_00,
    buyNowPrice: 1_800_00,
    endsInHours: 240,
    tags: ['dyson', 'vacuum', 'home'],
  },
  {
    title: 'Louis Vuitton Neverfull MM Damier Ebene — Authenticated',
    description:
      'Authenticated by Entrupy, certificate included with the sale. Date code confirms a 2019 France production.\n\nCanvas is excellent. The vachetta leather has an even honey patina, which is exactly what you want on this bag. Interior is clean, no pen marks. Includes the removable pouch and dust bag.\n\nCorners show light rubbing consistent with careful use — photographed close up so there are no surprises.',
    categorySlug: 'bags-luggage',
    sellerHandle: 'sitin',
    kind: 'AUCTION_WITH_BUY_NOW',
    condition: 'GOOD',
    startPrice: 2_500_00,
    reservePrice: 4_200_00,
    buyNowPrice: 6_500_00,
    endsInHours: 34,
    tags: ['louis vuitton', 'handbag', 'luxury'],
    bids: [
      { handle: 'gracechong', max: 3_600_00 },
      { handle: 'meiling', max: 4_400_00 },
    ],
  },
  {
    title: 'Lot of 12 Refurbished Dell OptiPlex 7080 Micro — i5/16GB/512GB',
    description:
      'Office clearance lot of twelve Dell OptiPlex 7080 Micro units. Each has an i5-10500T, 16GB RAM and a 512GB NVMe drive.\n\nAll wiped to DoD standard, tested and booting to BIOS. Windows 11 Pro licences are digital and tied to the boards. Power adapters included for every unit.\n\nSold as one lot only — ideal for a small office refresh or a computer lab. Collection from a Kuala Lumpur warehouse, or we can arrange a lorry at cost.',
    categorySlug: 'office-equipment',
    sellerHandle: 'limweisheng',
    kind: 'AUCTION',
    condition: 'REFURBISHED',
    startPrice: 4_000_00,
    reservePrice: 7_000_00,
    endsInHours: 60,
    tags: ['dell', 'bulk', 'office', 'refurbished'],
    bids: [{ handle: 'danieltan', max: 5_200_00 }],
  },
  {
    title: 'Yamaha YZF-R15 V4 2023 — 8,400km',
    description:
      'One owner from new, first service and every service since done at Hong Leong Yamaha. 8,400km on the clock.\n\nStock exhaust included alongside the fitted slip-on. No drops, no scratches on the fairing. Tyres are the originals with plenty of tread left.\n\nInsurance and road tax valid. Selling as I have moved back to a car for the daily commute.',
    categorySlug: 'motorcycles',
    sellerHandle: 'faizab',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 6_000_00,
    endsInHours: 78,
    tags: ['yamaha', 'r15', 'motorcycle'],
    bids: [
      { handle: 'rajeshk', max: 8_500_00 },
      { handle: 'sitin', max: 9_200_00 },
    ],
  },
  {
    title: 'Air Jordan 1 Retro High OG Chicago Lost & Found US10',
    description:
      'Deadstock, never worn, never tried on beyond a quick check on carpet. US10 / EU44.\n\nOriginal box in good shape with the special Lost & Found packaging details intact, plus the extra laces and the receipt from the raffle.\n\nStored in a climate-controlled room away from sunlight since release day.',
    categorySlug: 'sneakers',
    sellerHandle: 'danieltan',
    kind: 'AUCTION',
    condition: 'NEW',
    startPrice: 1_500_00,
    endsInHours: 15,
    tags: ['jordan', 'nike', 'sneakers'],
    bids: [
      { handle: 'faizab', max: 2_200_00 },
      { handle: 'aisharahman', max: 2_600_00 },
      { handle: 'meiling', max: 2_900_00 },
    ],
  },
  {
    title: 'Vintage Omega Seamaster De Ville 1962 — Serviced 2024',
    description:
      'Cal. 562 automatic, serviced last year by a watchmaker in Penang who specialises in vintage Omega. Keeping within a few seconds a day.\n\nOriginal dial with beautiful even patina, no redial. Case has been lightly polished at some point in its life, as most of these have. Acrylic crystal recently replaced.\n\nOn an aftermarket leather strap. A genuine 1962 piece for someone who appreciates them.',
    categorySlug: 'watches',
    sellerHandle: 'meiling',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 1_800_00,
    reservePrice: 3_000_00,
    endsInHours: 1,
    tags: ['omega', 'vintage', 'watch'],
    bids: [
      { handle: 'rajeshk', max: 2_400_00 },
      { handle: 'limweisheng', max: 3_100_00 },
    ],
  },
  // --- already closed, to give the marketplace history ---
  {
    title: 'Samsung Galaxy S23 Ultra 512GB Green',
    description:
      'Excellent condition, used for eleven months with a case and screen protector from day one. Battery health is strong and it holds a full day easily.\n\nComes with the box, cable, and a spare official case. S Pen works perfectly, no scratches on the screen.\n\nUpgrading through a carrier plan so this needs a new home.',
    categorySlug: 'mobile-phones',
    sellerHandle: 'danieltan',
    kind: 'AUCTION',
    condition: 'GOOD',
    startPrice: 1_500_00,
    endsInHours: -6,
    tags: ['samsung', 'galaxy', 'smartphone'],
    bids: [
      { handle: 'sitin', max: 2_400_00 },
      { handle: 'aisharahman', max: 2_800_00 },
      { handle: 'faizab', max: 3_100_00 },
    ],
  },
  {
    title: 'iPad Pro 12.9" M2 256GB + Magic Keyboard',
    description:
      'The 2022 M2 model with the Magic Keyboard and a second-generation Apple Pencil. Screen is flawless.\n\nUsed for note-taking at university, always in the keyboard case. Charges and holds battery as new.\n\nSelling the whole setup together — I would rather it went to one person than be split up.',
    categorySlug: 'laptops-computers',
    sellerHandle: 'aisharahman',
    kind: 'AUCTION',
    condition: 'LIKE_NEW',
    startPrice: 2_000_00,
    endsInHours: -30,
    tags: ['ipad', 'apple', 'tablet'],
    bids: [
      { handle: 'meiling', max: 3_000_00 },
      { handle: 'rajeshk', max: 3_400_00 },
    ],
  },
];

async function main() {
  console.log('› clearing existing data');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AdEvent","AdDailyStat","AdWalletTx","AdCreative","CampaignCategory","AdCampaign","Advertiser",
      "RfqQuote","Rfq","InvoiceLine","Invoice","ApprovalRequest","OrgMember","Organization",
      "Dispute","Review","Payment","Order","Watchlist","Bid","Listing","Category",
      "Notification","AuditLog","KycSubmission","Session","PlatformSetting","User"
    RESTART IDENTITY CASCADE
  `);

  console.log('› categories');
  const categoryBySlug = new Map<string, string>();
  for (const [i, parent] of CATEGORIES.entries()) {
    const created = await prisma.category.create({
      data: { name: parent.name, slug: parent.slug, icon: parent.icon, position: i },
    });
    categoryBySlug.set(parent.slug, created.id);
    for (const [j, [name, slug]] of parent.children.entries()) {
      const child = await prisma.category.create({
        data: { name, slug, parentId: created.id, position: j },
      });
      categoryBySlug.set(slug, child.id);
    }
  }

  console.log('› users');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userByHandle = new Map<string, string>();
  for (const u of USERS) {
    const created = await prisma.user.create({
      data: {
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        handle: u.handle,
        roles: u.roles,
        city: u.city ?? null,
        state: u.state ?? null,
        verified: u.verified ?? false,
        kycStatus: u.verified ? 'APPROVED' : 'NONE',
        accountType: u.accountType ?? 'PERSONAL',
        avatarUrl: img(`avatar-${u.handle}`, 200, 200),
        ratingSum: u.verified ? 47 : 18,
        ratingCount: u.verified ? 10 : 4,
      },
    });
    userByHandle.set(u.handle, created.id);
  }

  console.log('› corporate organisation');
  const org = await prisma.organization.create({
    data: {
      name: 'MegaCorp Industries Sdn Bhd',
      slug: 'megacorp-industries',
      registrationNo: '201901012345',
      taxId: 'C24680135790',
      industry: 'Manufacturing',
      billingEmail: 'finance@megacorp.my',
      addressLine1: 'Level 22, Menara MegaCorp, Jalan Ampang',
      city: 'Kuala Lumpur',
      state: 'Kuala Lumpur',
      postcode: '50450',
      monthlyBudget: 250_000_00,
      defaultApprovalThreshold: 5_000_00,
      creditLimit: 100_000_00,
      paymentTerms: 'NET_30',
      verified: true,
    },
  });
  const orgSeats: [string, 'OWNER' | 'ADMIN' | 'APPROVER' | 'BUYER' | 'VIEWER', number | null][] = [
    ['limweisheng', 'OWNER', null],
    ['kamaladevi', 'APPROVER', null],
    ['hafizismail', 'BUYER', 2_000_00],
    ['gracechong', 'BUYER', 10_000_00],
  ];
  for (const [handle, orgRole, threshold] of orgSeats) {
    await prisma.orgMember.create({
      data: {
        orgId: org.id,
        userId: userByHandle.get(handle)!,
        orgRole,
        approvalThreshold: threshold,
      },
    });
  }

  console.log('› listings');
  const listingIds: { id: string; def: SeedListing; realEndsAt: Date }[] = [];
  for (const def of LISTINGS) {
    const realEndsAt = new Date(Date.now() + def.endsInHours * HOUR);
    // Past auctions are opened in the future so their bids can go through the
    // real engine, then rewound and settled once the bidding is in place.
    const endsAt = def.endsInHours < 0 ? new Date(Date.now() + HOUR) : realEndsAt;
    const startsAt = new Date(realEndsAt.getTime() - 7 * DAY);
    const state = STATES[Math.abs(hash(def.title)) % STATES.length]!;

    const created = await prisma.listing.create({
      data: {
        slug: slugFor(def.title),
        title: def.title,
        description: def.description,
        kind: def.kind,
        status: 'LIVE',
        condition: def.condition,
        sellerId: userByHandle.get(def.sellerHandle)!,
        categoryId: categoryBySlug.get(def.categorySlug)!,
        images: [1, 2, 3].map((n) => img(`${def.tags[0]}-${n}-${hash(def.title)}`)),
        tags: def.tags,
        startPrice: def.startPrice,
        currentPrice: def.startPrice,
        reservePrice: def.reservePrice ?? null,
        buyNowPrice: def.buyNowPrice ?? null,
        shippingCost: def.categorySlug === 'cars' || def.categorySlug === 'motorcycles' ? 0 : 15_00,
        localPickup: true,
        startsAt,
        endsAt,
        originalEndsAt: endsAt,
        featured: def.featured ?? false,
        locationState: state,
        locationCity: state === 'Kuala Lumpur' ? 'Kuala Lumpur' : `${state} town`,
        viewCount: 40 + (Math.abs(hash(def.title)) % 900),
      },
    });
    listingIds.push({ id: created.id, def, realEndsAt });
  }

  console.log('› bids (through the real engine)');
  for (const { id, def } of listingIds) {
    for (const bid of def.bids ?? []) {
      const bidderId = userByHandle.get(bid.handle);
      if (!bidderId) continue;
      try {
        await placeBidForUser(
          { listingId: id, bidderId, maxAmount: bid.max },
          { skipApprovalGate: true },
        );
      } catch (err) {
        console.warn(`  · skipped bid by ${bid.handle}: ${(err as Error).message}`);
      }
    }
  }

  console.log('› watchlists');
  const watchers = ['aisharahman', 'danieltan', 'sitin', 'meiling', 'faizab'];
  for (const [i, { id }] of listingIds.entries()) {
    for (const handle of watchers.slice(0, (i % 4) + 1)) {
      const userId = userByHandle.get(handle)!;
      const listing = await prisma.listing.findUniqueOrThrow({
        where: { id },
        select: { sellerId: true },
      });
      if (listing.sellerId === userId) continue;
      await prisma.watchlist.create({ data: { userId, listingId: id } }).catch(() => undefined);
      await prisma.listing.update({ where: { id }, data: { watchCount: { increment: 1 } } });
    }
  }

  console.log('› settling the auctions that already closed');
  for (const { id, def, realEndsAt } of listingIds) {
    if (def.endsInHours >= 0) continue;
    await prisma.listing.update({
      where: { id },
      data: { endsAt: realEndsAt, originalEndsAt: realEndsAt },
    });
    await settleListing(id);
  }

  console.log('› moving one closed sale through payment and delivery');
  const completed = await prisma.order.findFirst({ orderBy: { createdAt: 'asc' } });
  if (completed) {
    await prisma.payment.create({
      data: {
        orderId: completed.id,
        amount: completed.total,
        method: 'FPX',
        status: 'SUCCEEDED',
        providerRef: 'MOCK-SEED-0001',
        settledAt: new Date(Date.now() - 2 * DAY),
      },
    });
    await prisma.order.update({
      where: { id: completed.id },
      data: {
        status: 'COMPLETED',
        paymentMethod: 'FPX',
        paymentRef: 'MOCK-SEED-0001',
        paidAt: new Date(Date.now() - 2 * DAY),
        shippingName: 'Siti Nurhaliza',
        shippingPhone: '+60123456789',
        addressLine1: '12 Jalan Molek 1/5',
        city: 'Johor Bahru',
        state: 'Johor',
        postcode: '81100',
        courier: 'J&T Express',
        trackingNumber: 'JT8842019374',
        shippedAt: new Date(Date.now() - DAY),
        deliveredAt: new Date(Date.now() - 6 * HOUR),
        completedAt: new Date(Date.now() - 6 * HOUR),
      },
    });
    await prisma.user.update({
      where: { id: completed.sellerId },
      data: { balance: { increment: completed.sellerPayout } },
    });
    await prisma.review.create({
      data: {
        orderId: completed.id,
        authorId: completed.buyerId,
        subjectId: completed.sellerId,
        rating: 5,
        comment: 'Exactly as described, packed well and posted the same day. Would buy again.',
      },
    });
  }

  console.log('› advertiser campaigns');
  const brandco = await prisma.advertiser.create({
    data: {
      userId: userByHandle.get('brandco')!,
      companyName: 'BrandCo Marketing Sdn Bhd',
      website: 'https://brandco.example.my',
      contactEmail: 'advertiser@brandco.my',
      balance: 5_000_00,
      lifetimeSpend: 1_250_00,
      approved: true,
    },
  });
  const techstore = await prisma.advertiser.create({
    data: {
      userId: userByHandle.get('techstoreads')!,
      companyName: 'TechStore Malaysia',
      website: 'https://techstore.example.my',
      contactEmail: 'ads@techstore.my',
      balance: 12_000_00,
      lifetimeSpend: 3_400_00,
      approved: true,
    },
  });

  const campaignIdsForStats: string[] = [];
  const campaign1 = await prisma.adCampaign.create({
    data: {
      advertiserId: techstore.id,
      name: 'Raya Electronics Push',
      objective: 'TRAFFIC',
      status: 'ACTIVE',
      pricingModel: 'CPC',
      bidAmount: 1_20,
      dailyBudget: 200_00,
      totalBudget: 3_000_00,
      spend: 340_00,
      impressions: 48_200,
      clicks: 1_180,
      startsAt: new Date(Date.now() - 10 * DAY),
      endsAt: new Date(Date.now() + 20 * DAY),
      placements: ['HOME_HERO', 'SEARCH_INLINE', 'MOBILE_FEED'],
      targetKeywords: ['iphone', 'laptop', 'macbook', 'camera'],
      targetStates: [],
      categories: {
        create: [
          { categoryId: categoryBySlug.get('electronics')! },
          { categoryId: categoryBySlug.get('mobile-phones')! },
        ],
      },
      creatives: {
        create: [
          {
            headline: 'Certified refurbished laptops from RM1,299',
            body: '12-month warranty, next-day delivery nationwide.',
            imageUrl: img('ad-techstore-laptops', 1200, 400),
            ctaLabel: 'Shop laptops',
            ctaUrl: 'https://techstore.example.my/laptops',
          },
          {
            headline: 'Trade in your old phone, get RM500 off',
            body: 'Instant valuation at any TechStore outlet.',
            imageUrl: img('ad-techstore-tradein', 1200, 400),
            ctaLabel: 'Get a quote',
            ctaUrl: 'https://techstore.example.my/trade-in',
          },
        ],
      },
    },
  });

  const campaign2 = await prisma.adCampaign.create({
    data: {
      advertiserId: brandco.id,
      name: 'Luxury Watch Collectors — Awareness',
      objective: 'AWARENESS',
      status: 'ACTIVE',
      pricingModel: 'CPM',
      bidAmount: 18_00,
      dailyBudget: 100_00,
      spend: 120_00,
      impressions: 22_400,
      clicks: 210,
      startsAt: new Date(Date.now() - 4 * DAY),
      placements: ['LISTING_SIDEBAR', 'CATEGORY_BANNER', 'HOME_FEED'],
      targetKeywords: ['rolex', 'omega', 'watch', 'luxury'],
      targetStates: ['Kuala Lumpur', 'Selangor'],
      categories: { create: [{ categoryId: categoryBySlug.get('watches')! }] },
      creatives: {
        create: [
          {
            headline: 'Insure your collection from RM40/month',
            body: 'Specialist cover for watches, jewellery and art.',
            imageUrl: img('ad-brandco-insure', 1200, 400),
            ctaLabel: 'Get covered',
            ctaUrl: 'https://brandco.example.my/collectibles-cover',
          },
        ],
      },
    },
  });

  await prisma.adCampaign.create({
    data: {
      advertiserId: brandco.id,
      name: 'Q3 Vehicle Financing (pending review)',
      objective: 'LISTING_PROMOTION',
      status: 'PENDING_REVIEW',
      pricingModel: 'CPC',
      bidAmount: 2_50,
      dailyBudget: 300_00,
      startsAt: new Date(Date.now() + DAY),
      placements: ['CATEGORY_BANNER'],
      targetKeywords: ['car', 'myvi', 'motorcycle'],
      targetStates: [],
      categories: { create: [{ categoryId: categoryBySlug.get('vehicles')! }] },
      creatives: {
        create: [
          {
            headline: 'Vehicle financing at 2.88% flat',
            body: 'Approval in 24 hours for AnyBid buyers.',
            imageUrl: img('ad-brandco-finance', 1200, 400),
            ctaLabel: 'Check eligibility',
            ctaUrl: 'https://brandco.example.my/auto-loan',
          },
        ],
      },
    },
  });

  // Backfill 14 days of statistics for both advertisers so the reporting
  // charts in the Advertiser console have real shape from the first load.
  campaignIdsForStats.push(campaign1.id, campaign2.id);
  for (const [index, campaignId] of campaignIdsForStats.entries()) {
    const cpc = index === 0;
    for (let d = 13; d >= 0; d--) {
      const date = new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ) - d * DAY);
      const impressions = (cpc ? 2_000 : 1_100) + ((d * (cpc ? 733 : 411)) % 2_500);
      const clicks = Math.round(impressions * (0.018 + ((d % 5) * 0.002)));
      await prisma.adDailyStat.create({
        data: {
          campaignId,
          date,
          impressions,
          clicks,
          spend: cpc ? clicks * 1_20 : Math.round((impressions / 1000) * 18_00),
        },
      });
    }
  }

  console.log('› a pending corporate approval');
  const bigTicket = listingIds.find((l) => l.def.categorySlug === 'cars');
  if (bigTicket) {
    await prisma.approvalRequest.create({
      data: {
        orgId: org.id,
        listingId: bigTicket.id,
        requestedById: userByHandle.get('hafizismail')!,
        amount: 33_000_00,
        reference: 'PO-2026-0417',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    await prisma.notification.create({
      data: {
        userId: userByHandle.get('kamaladevi')!,
        type: 'APPROVAL_REQUESTED',
        title: 'Bid approval needed',
        body: 'Hafiz Ismail wants to bid RM33,000.00 on a Perodua Myvi 1.5 AV 2019.',
        link: '/corporate/approvals',
      },
    });
  }

  console.log('› platform settings');
  await prisma.platformSetting.create({
    data: {
      key: 'platform',
      value: {
        sellerCommissionBps: 600,
        buyerPremiumBps: 0,
        paymentProcessingBps: 220,
        paymentFlatFee: 100,
        minCommission: 100,
        maxCommission: 50_000,
        defaultAntiSnipeWindowSec: 120,
        defaultAntiSnipeExtensionSec: 120,
        maintenanceMode: false,
        newListingsRequireReview: false,
      },
    },
  });

  const [users, listings, bids, orders] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.bid.count(),
    prisma.order.count(),
  ]);

  console.log(`
✓ AnyBid seeded
  ${users} users · ${listings} listings · ${bids} bids · ${orders} orders

  Sign in with password "${DEMO_PASSWORD}":
    admin@anybid.my            super admin  → Admin console
    aisha@example.com          buyer/seller → User console
    advertiser@brandco.my      advertiser   → Advertiser console
    procurement@megacorp.my    org owner    → Corporate console
    buyer2@megacorp.my         org buyer    → needs approval above RM10,000
`);
}

function slugFor(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${base}-${Math.abs(hash(title)).toString(36).slice(0, 6)}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
