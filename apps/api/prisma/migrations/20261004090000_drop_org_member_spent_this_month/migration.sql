-- OrgMember.spentThisMonth was incremented at settlement and never reset, so a
-- column named for the month held every sale the member had ever won. The
-- month's figure is derived from their orders instead, which is what the spend
-- report already did — so the column is dropped rather than left to be trusted.
ALTER TABLE "OrgMember" DROP COLUMN "spentThisMonth";
