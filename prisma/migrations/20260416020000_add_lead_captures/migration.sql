-- CreateTable
CREATE TABLE "lead_captures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "session_id" TEXT,
    "full_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'chat_widget',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_captures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_captures_site_id_created_at_idx" ON "lead_captures"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_captures_email_idx" ON "lead_captures"("email");

-- AddForeignKey
ALTER TABLE "lead_captures" ADD CONSTRAINT "lead_captures_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
