# Sample knowledge (demo)

This file is for local RAG testing. After you run the ingest CLI, the assistant should answer from this content.

## Widget

The **greenfield-chat-widget** project provides an embeddable chat bubble and a Next.js API for streaming replies.

## Phase B

Phase B adds **pgvector** retrieval: user questions are embedded, similar chunks are fetched from Postgres, and the model answers with citations like `[1]`.
