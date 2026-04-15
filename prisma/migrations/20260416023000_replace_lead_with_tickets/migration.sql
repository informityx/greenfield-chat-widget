-- Drop old lead table if present
DROP TABLE IF EXISTS "lead_captures";

-- Drop enums if they already exist from previous runs
DROP TYPE IF EXISTS "TicketType";
DROP TYPE IF EXISTS "TicketPriority";
DROP TYPE IF EXISTS "TicketStatus";

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('support', 'sales_lead', 'general');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "session_id" TEXT,
    "full_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "type" "TicketType" NOT NULL DEFAULT 'general',
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "summary" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tickets_site_id_created_at_idx" ON "tickets"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "tickets_email_idx" ON "tickets"("email");

-- CreateIndex
CREATE INDEX "tickets_status_priority_idx" ON "tickets"("status", "priority");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
