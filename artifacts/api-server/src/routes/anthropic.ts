import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, conversations, messages } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/anthropic/conversations", async (req, res) => {
  try {
    const result = await db
      .select()
      .from(conversations)
      .orderBy(conversations.createdAt);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing conversations");
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

router.post("/anthropic/conversations", async (req, res) => {
  const { title } = req.body as { title: string };
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const [conversation] = await db
      .insert(conversations)
      .values({ title })
      .returning();
    res.status(201).json(conversation);
  } catch (err) {
    req.log.error({ err }, "Error creating conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/anthropic/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  try {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const convMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    res.json({ ...conversation, messages: convMessages });
  } catch (err) {
    req.log.error({ err }, "Error getting conversation");
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.delete("/anthropic/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(conversations)
      .where(eq(conversations.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting conversation");
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/anthropic/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  try {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing messages");
    res.status(500).json({ error: "Failed to list messages" });
  }
});

router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const { content, systemContext } = req.body as {
    content: string;
    systemContext?: string;
  };

  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await db.insert(messages).values({
      conversationId: id,
      role: "user",
      content,
    });

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    const systemPrompt = systemContext ||
      `You are a knowledgeable exam preparation assistant. Help the student understand concepts, solve problems, and prepare effectively. Be clear, concise, and encouraging.`;

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(
          `data: ${JSON.stringify({ content: event.delta.text })}\n\n`,
        );
      }
    }

    await db.insert(messages).values({
      conversationId: id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error processing message");
    res.write(
      `data: ${JSON.stringify({ error: "Failed to process message" })}\n\n`,
    );
    res.end();
  }
});

export default router;
