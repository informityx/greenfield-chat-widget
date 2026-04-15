/**
 * Must use the same algorithm as apps/web/lib/publishable-key.ts (HMAC-SHA256 hex).
 * Run: PUBLISHABLE_KEY_PEPPER=your-secret npx prisma db seed
 */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPublishableKey(pepper: string, publishableKey: string): string {
  return createHmac("sha256", pepper).update(publishableKey, "utf8").digest("hex");
}

async function main() {
  const pepper = process.env.PUBLISHABLE_KEY_PEPPER;
  if (!pepper) {
    throw new Error("Set PUBLISHABLE_KEY_PEPPER in the environment before seeding.");
  }

  const demoKey = process.env.SEED_DEMO_PUBLISHABLE_KEY ?? "pk_test_demo";
  const hash = hashPublishableKey(pepper, demoKey);

  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://theexpertways.com",
    "https://www.theexpertways.com",
    "https://informityx.com",
    "https://www.informityx.com",
  ];

  await prisma.site.upsert({
    where: { siteId: "demo-site" },
    create: {
      siteId: "demo-site",
      publishableKeyHash: hash,
      allowedOrigins,
    },
    update: {
      publishableKeyHash: hash,
      allowedOrigins,
    },
  });

  console.log("Seeded site demo-site with publishable key matching SEED_DEMO_PUBLISHABLE_KEY or default pk_test_demo.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
