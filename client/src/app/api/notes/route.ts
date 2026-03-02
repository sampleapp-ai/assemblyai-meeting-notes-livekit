import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.CEREBRAS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing CEREBRAS_API_KEY" },
      { status: 500 }
    );
  }

  const { transcript } = await req.json();

  if (!transcript || transcript.trim().length === 0) {
    return NextResponse.json(
      { error: "Empty transcript" },
      { status: 400 }
    );
  }

  const response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama3.1-8b",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are a meeting notes assistant. Given a meeting transcript, generate structured meeting notes.

Return ONLY valid JSON with this exact structure:
{
  "summary": "A 2-3 sentence overview of what was discussed",
  "keyPoints": ["point 1", "point 2"],
  "decisions": ["decision 1", "decision 2"],
  "actionItems": ["action item 1", "action item 2"]
}

If a section has no items, use an empty array. Be concise and specific.`,
        },
        {
          role: "user",
          content: `Here is the meeting transcript:\n\n${transcript}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Failed to generate notes" },
      { status: 500 }
    );
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || "{}";

  try {
    const notes = JSON.parse(content);
    return NextResponse.json({ notes });
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const notes = JSON.parse(jsonMatch[0]);
        return NextResponse.json({ notes });
      } catch {
        return NextResponse.json(
          { error: "Failed to parse notes" },
          { status: 500 }
        );
      }
    }
    return NextResponse.json(
      { error: "Failed to parse notes" },
      { status: 500 }
    );
  }
}
