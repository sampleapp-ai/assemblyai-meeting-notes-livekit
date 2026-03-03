# Meeting Notes — LiveKit + AssemblyAI Universal-3 Pro

A listen-only meeting agent that transcribes speech in real time using AssemblyAI's Universal-3 Pro streaming STT and generates structured meeting notes (summary, key points, decisions, action items) via an LLM at the end of the session.

## Architecture

```
Browser (Next.js)                 LiveKit Cloud                Python Agent
┌──────────────┐    WebRTC     ┌───────────────┐   Audio    ┌──────────────────┐
│ Mic audio  ──┼──────────────▶│               │──────────▶│ AssemblyAI U3P   │
│              │               │  Room/Signal  │           │ STT (streaming)  │
│ Live         │◀──────────────│               │◀──────────│ Transcriptions   │
│ transcript   │  Transcripts  └───────────────┘           └──────────────────┘
│              │
│ End Meeting  │──▶ POST /api/notes ──▶ Cerebras LLM ──▶ Structured Notes
└──────────────┘
```

**Key difference from voice agent:** This agent is passive — it never speaks. No TTS, no `generate_reply()`. It only listens and transcribes.

## How It Works

1. User clicks **Start Meeting** — connects to LiveKit room with microphone
2. Python agent joins the room and transcribes all audio via AssemblyAI U3P
3. Transcriptions appear in the browser in real time
4. User clicks **End Meeting** — transcript is sent to Cerebras LLM to generate structured notes
5. Notes are displayed with summary, key points, decisions, and action items

## U3P Configuration for Meetings

Meetings have longer pauses than conversations, so turn detection is relaxed:

| Parameter | Value | Why |
|---|---|---|
| `min_turn_silence` | 560ms | Allow natural pauses before checking for punctuation |
| `max_turn_silence` | 2000ms | Speakers pause to think — avoid cutting off mid-thought |
| `keyterms_prompt` | Meeting vocabulary | Boost recognition of project names, action items, etc. |

## Prerequisites

- [LiveKit Cloud](https://cloud.livekit.io/) account
- [AssemblyAI](https://www.assemblyai.com/) API key
- [Cerebras](https://cerebras.ai/) API key
- Python 3.12+
- Node.js 22+

## Setup

### Server

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Fill in your API keys
python meeting_notes.py dev
```

### Client

```bash
cd client
npm install
cp .env.example .env.local  # Fill in your API keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Start Meeting**.

## Note on Speaker Diarization

Speaker diarization is not yet available in AssemblyAI's streaming API. For speaker-labeled meeting notes, use a hybrid approach: stream during the meeting for live captions, then process the recording through the async API for diarized, summarized notes.
