-- Persist full chat transcript on each ticket update (widget sends rolling history).
ALTER TABLE "tickets" ADD COLUMN "chat_history" JSONB;
