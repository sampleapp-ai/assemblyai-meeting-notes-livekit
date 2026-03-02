# Build: Meeting Notes Agent with LiveKit + AssemblyAI Universal-3 Pro

## Goal

Build a listen-only meeting agent using LiveKit Agents SDK and AssemblyAI's Universal-3 Pro streaming STT. The agent joins a LiveKit room, transcribes all speech in real time, collects transcript turns, and generates structured meeting notes (agenda items, decisions, action items) at session end via an LLM call. **No TTS output** — this is a passive listener, not a conversational agent.

---

## AssemblyAI Universal-3 Pro (U3P) Streaming Context

U3P (`speech_model: "u3-rt-pro"`) is optimized for real-time audio utterances under 10 seconds with sub-300ms time-to-complete-transcript latency. Highest accuracy for entities, rare words, and domain-specific terminology.

### Connection

WebSocket endpoint: `wss://streaming.assemblyai.com/v3/ws`

```json
{
  "speech_model": "u3-rt-pro",
  "sample_rate": 16000
}
```

### Punctuation-Based Turn Detection

U3P uses punctuation-based turn detection controlled by two parameters:

| Parameter | Default | Description |
|---|---|---|
| `min_end_of_turn_silence_when_confident` | 100ms | Silence before a speculative EOT check fires. Model transcribes audio and checks for terminal punctuation (`.` `?` `!`). |
| `max_turn_silence` | 1200ms | Maximum silence before a turn is forced to end, regardless of punctuation. |

**How it works:**
1. Silence reaches `min_end_of_turn_silence_when_confident` → model checks for terminal punctuation
2. Terminal punctuation found → turn ends (`end_of_turn: true`)
3. No terminal punctuation → partial emitted (`end_of_turn: false`), turn continues
4. Silence reaches `max_turn_silence` → turn forced to end (`end_of_turn: true`)

**Important:** `end_of_turn` and `turn_is_formatted` always have the same value — every end-of-turn transcript is already formatted.

### Prompting

**`keyterms_prompt`** — Boost recognition of specific names, brands, or domain terms. Array of strings:
```json
{ "keyterms_prompt": ["Alice Johnson", "Project Phoenix", "Q3 roadmap"] }
```

**`prompt`** — Behavioral/formatting instructions for the STT stream. When omitted, a built-in default prompt optimized for turn detection is applied (88% turn detection accuracy out of the box).

**`prompt` and `keyterms_prompt` are mutually exclusive.** When you use `keyterms_prompt`, your terms are appended to the default prompt automatically.

### Mid-Stream Configuration Updates

`UpdateConfiguration` changes parameters during an active session without reconnecting:

```json
{
  "type": "UpdateConfiguration",
  "keyterms_prompt": ["budget review", "Q4 targets", "headcount"],
  "max_turn_silence": 3000
}
```

Updatable fields: `keyterms_prompt`, `prompt`, `max_turn_silence`, `min_end_of_turn_silence_when_confident`.

### ForceEndpoint

Force the current turn to end immediately:
```json
{ "type": "ForceEndpoint" }
```

### Partials Behavior

Partials are `Turn` events where `end_of_turn: false`. At most one partial per silence period.

### Not Available in Streaming

- **Speaker diarization** — Coming Soon for streaming
- **PII redaction** — Async-only
- **Summarization, sentiment analysis, entity detection** — Async Speech Understanding features

> **Hybrid approach:** Stream during the meeting for live captions, then process the recording through the async API for speaker-diarized, summarized notes.

---

## Use Case: Meeting Notes — Live Meeting Summarizer

Meeting assistant that transcribes in real time and generates structured notes (agenda items, decisions, action items) at the end.

**U3P features used:**

| Feature | How it's used |
|---|---|
| Formatting intelligence | Distinguishes statements, questions, and trailing speech via punctuation. |
| `keyterms_prompt` | Meeting-specific vocabulary: participant names, project names, technical terms. |
| `UpdateConfiguration` | Update keyterms mid-stream as new topics arise. |
| Higher `max_turn_silence` | Meeting speakers pause to think — use 2000ms to avoid cutting off mid-thought. |

**Turn detection config (balanced — wait for natural pauses):**

```json
{
  "speech_model": "u3-rt-pro",
  "min_end_of_turn_silence_when_confident": 560,
  "max_turn_silence": 2000
}
```

**Example keyterms:**
```python
["Alice Johnson", "Bob Smith", "Project Phoenix", "Q3 roadmap", "quarterly review", "action items", "deadline", "budget"]
```

---

## Tech Stack: LiveKit Agents SDK (Listen-Only)

### Dependencies

```bash
pip install "livekit-agents[assemblyai,openai,silero]" python-dotenv
```

Note: No `rime` (TTS) or `noise_cancellation` needed — this is a listen-only agent.

### API Keys Needed

- **AssemblyAI** — STT (`ASSEMBLYAI_API_KEY`)
- **Cerebras** or **OpenAI** — LLM for note generation (`CEREBRAS_API_KEY` or `OPENAI_API_KEY`)
- **LiveKit Cloud** — WebRTC transport (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)

### .env.example

```env
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
CEREBRAS_API_KEY=your_cerebras_api_key
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

### Adaptation: Voice Agent Pattern → Listen-Only Meeting Agent

Start from the LiveKit voice agent pattern but make these key changes:

1. **Remove TTS** — No `tts` parameter in `AgentSession`, no Rime dependency
2. **Remove `generate_reply`** — The agent never speaks
3. **Remove noise cancellation** — Optional for listen-only
4. **Add transcript collection** — Listen for STT events and accumulate finalized turns in a buffer
5. **Add note generation** — When the session ends (or on command), send the collected transcript to an LLM to generate structured meeting notes
6. **Adjust turn detection** — Use balanced config (560ms / 2000ms) instead of aggressive (100ms / 1200ms)

### Conceptual Code Structure

```python
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import assemblyai, openai, silero

load_dotenv()

# Buffer for collecting transcript turns
transcript_buffer = []


class MeetingListener(Agent):
    def __init__(self) -> None:
        super().__init__(instructions="You are a meeting note-taking assistant. Listen to the conversation and collect all transcript turns.")


async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()

    session = AgentSession(
        stt=assemblyai.STT(
            min_end_of_turn_silence_when_confident=560,
            max_turn_silence=2000,
            keyterms_prompt=["Alice Johnson", "Bob Smith", "Project Phoenix", "Q3 roadmap"],
        ),
        llm=openai.LLM.with_cerebras(
            model="llama3.1-8b",
            temperature=0.3,
        ),
        vad=silero.VAD.load(),
        turn_detection="stt",
        # NO TTS — listen-only agent
    )

    # Listen for transcription events and collect turns
    @session.on("user_input_transcribed")
    def on_transcription(transcript):
        transcript_buffer.append({
            "timestamp": transcript.timestamp,
            "text": transcript.text,
            "is_final": transcript.is_final,
        })

    await session.start(
        room=ctx.room,
        agent=MeetingListener(),
    )

    # When session ends, generate structured notes
    @ctx.room.on("disconnected")
    async def on_disconnect():
        await generate_meeting_notes(transcript_buffer)


async def generate_meeting_notes(turns):
    """Send collected transcript to LLM for structured note generation."""
    transcript_text = "\n".join([t["text"] for t in turns if t["is_final"]])

    # Use LLM to generate structured notes
    # Output: Summary, Key Decisions, Action Items, Next Steps
    pass


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
```

**Important:** This is a conceptual structure. The actual event names and API may differ — consult the LiveKit Agents SDK documentation for the correct event handlers for receiving STT transcription results. The key architectural decisions are:
- No TTS in the pipeline
- Collect all finalized turns in a buffer
- Generate notes via LLM at session end

### How to Run

```bash
python meeting_notes.py dev
```

Then open LiveKit Agents Playground, select your project, and click "Connect". The agent will listen and transcribe without speaking.

---

## Deliverables Checklist

- [ ] `meeting_notes.py` — Working listen-only meeting agent
- [ ] `.env.example` — Template with all required API keys
- [ ] `requirements.txt` — All Python dependencies
- [ ] `README.md` — Setup instructions, prerequisites, how to run, architecture overview, explanation of listen-only approach
- [ ] `guide.mdx` — Step-by-step documentation using `codefocussection` components

### guide.mdx Format

```jsx
<codefocussection
  filepath="meeting_notes.py"
  filerange="1-12"
  title="Import libraries and configure environment"
  themeColor="#0000FF"
  label="Server"
>
  Description of imports and setup.
</codefocussection>
```

Break the guide into: imports, transcript buffer, agent class (listen-only), session setup (STT config with balanced turn detection, no TTS), transcript collection, note generation via LLM, and running the agent.

### Async-Only Note

Speaker diarization is not available in streaming. For speaker-labeled meeting notes, use a hybrid approach: stream during the meeting for live captions, then process the recording through the async API for diarized notes. Mention this in the README.
