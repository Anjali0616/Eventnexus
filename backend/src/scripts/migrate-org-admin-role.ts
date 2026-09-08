/**
 * Data migration: split the overloaded "admin" role into "admin" (platform
 * system administrator) and "org_admin" (tenant administrator).
 *
 * Before the role split, a tenant's administrator was stored as
 * role: "admin" WITH an organization set, and the platform administrator as
 * role: "admin" with NO organization. That inference-based distinction is
 * what allowed a tenant admin to reach platform-wide surfaces (the AI
 * training console retrains models shared across every tenant), so the two
 * are now separate, explicit roles.
 *
 * This backfills existing rows to match:
 *
 *     role: "admin" AND organization set   ->  role: "org_admin"
 *     role: "admin" AND no organization    ->  unchanged (system admin)
 *
 * Idempotent: re-running it is a no-op once every row is converted, because
 * the filter only ever matches rows still carrying the legacy shape.
 *
 * Deliberately does NOT bump tokenVersion. protect() re-reads the user
 * document (and therefore the role) from the database on every request, so
 * the new, narrower permissions take effect immediately on the next request
 * without forcing every tenant admin to sign in again.
 *
 * Run with:  npm run migrate:org-admin
 */

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "../models/User";

const run = async (): Promise<void> => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI as string;
  if (!uri) {
    console.error("✗ MONGO_URI is not set — nothing to migrate against.");
    process.exit(1);
  }

  await mongoose.connect(uri as string);
  console.log("✓ Connected");

  const legacyFilter = {
    role: "admin",
    organization: { $exists: true, $ne: null },
  };

  const candidates = await User.find(legacyFilter)
    .select("name email organization")
    .lean();

  if (!candidates.length) {
    console.log("✓ Nothing to migrate — no legacy tenant admins remain.");
  } else {
    console.log(`Found ${candidates.length} tenant admin(s) to convert:`);
    candidates.forEach((u) => console.log(`   · ${u.email} (${u.name})`));

    const result = await User.updateMany(legacyFilter, {
      $set: { role: "org_admin" },
    });
    console.log(`✓ Converted ${result.modifiedCount} account(s) to "org_admin"`);
  }

  // Report the resulting distribution so the operator can eyeball it.
  const summary = await User.aggregate([
    { $group: { _id: "$role", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  console.log("\nRole distribution now:");
  summary.forEach((r) => console.log(`   ${r._id}: ${r.count}`));

  // A system admin must never carry an organization — requireSystemAdmin
  // checks for its absence, so a stray one would be locked out of the very
  // console it exists to run. Surface it rather than silently "fixing" it,
  // since detaching an account from its tenant is not a call a migration
  // should make on its own.
  const suspicious = await User.countDocuments({
    role: "admin",
    organization: { $exists: true, $ne: null },
  });
  if (suspicious > 0) {
    console.warn(`\n⚠ ${suspicious} account(s) are still role "admin" with an organization.`);
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("✗ Migration failed:", error.message);
  process.exit(1);
});
