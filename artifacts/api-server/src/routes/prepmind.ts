import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

router.post("/prepmind/overview", async (req, res) => {
  const { examName } = req.body as { examName: string };

  if (!examName) {
    res.status(400).json({ error: "examName is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are an expert exam preparation coach. Provide a comprehensive overview for the "${examName}" exam.

Please structure your response with these clearly labeled sections:

## Exam Pattern
Describe the exam pattern, sections, number of questions, marks, duration.

## Difficulty Level
Describe the overall difficulty and which sections are hardest.

## Preparation Strategy
Provide a strategic approach to crack this exam.

## Time Plan
Suggest a realistic study time plan (e.g., 3-month plan).

## Syllabus Topics
List ALL important topics as a comma-separated list on a single line starting with "TOPICS:" like:
TOPICS: Quantitative Aptitude, Logical Reasoning, Verbal Ability, Data Interpretation, Computer Science, General Awareness

Be comprehensive and specific to ${examName}. Use markdown formatting for readability.`,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error streaming exam overview");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate overview" })}\n\n`);
    res.end();
  }
});

router.post("/prepmind/practice", async (req, res) => {
  const { examName, topic, difficulty, count = 5 } = req.body as {
    examName: string;
    topic: string;
    difficulty: string;
    count?: number;
  };

  if (!examName || !topic || !difficulty) {
    res.status(400).json({ error: "examName, topic, and difficulty are required" });
    return;
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are an expert ${examName} exam question creator. Generate ${count} ${difficulty} level MCQ questions on the topic: "${topic}" for the ${examName} exam.

Return ONLY a valid JSON object with this exact structure, no other text:
{
  "questions": [
    {
      "id": "q1",
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Detailed explanation of why the correct answer is right",
      "trick": "A shortcut or memory tip to solve similar questions quickly",
      "topic": "${topic}",
      "difficulty": "${difficulty}"
    }
  ]
}

Make questions realistic and at the exact difficulty level of ${examName}. The correctIndex is 0-based (0=A, 1=B, 2=C, 3=D). Ensure explanations are detailed and tricks are genuinely useful shortcuts.`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected response format" });
      return;
    }

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Could not parse questions from response" });
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    req.log.error({ err }, "Error generating practice questions");
    res.status(500).json({ error: "Failed to generate questions" });
  }
});

router.post("/prepmind/teach", async (req, res) => {
  const { examName, topic } = req.body as {
    examName: string;
    topic: string;
  };

  if (!examName || !topic) {
    res.status(400).json({ error: "examName and topic are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are a brilliant teacher preparing a student for the ${examName} exam. Teach the topic "${topic}" comprehensively.

Structure your teaching as:

## 📚 Core Concepts
Explain the fundamental concepts clearly.

## 📐 Formulas & Rules
List all important formulas, rules, and theorems with examples.

## ⚡ Shortcuts & Tricks
Provide exam-specific shortcuts, tricks, and time-saving techniques.

## 💡 Solved Examples
Work through 2-3 solved examples step by step.

## 🎯 Key Points to Remember
Bullet points of the most important things to memorize.

## ⚠️ Common Mistakes
Mistakes students commonly make and how to avoid them.

Make it engaging, practical, and specifically tailored for ${examName} level difficulty. Use emojis and markdown for readability.`,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error streaming teach content");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate teaching content" })}\n\n`);
    res.end();
  }
});

export default router;
