"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  LiveKitRoom,
  useVoiceAssistant,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
  VideoTrack,
} from "@livekit/components-react";
import { Track, RoomEvent, type TranscriptionSegment as LKTranscriptionSegment } from "livekit-client";

type AppState = "idle" | "recording" | "generating" | "notes";

interface MeetingNotes {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
}

export default function Page() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [connectionDetails, setConnectionDetails] = useState<{
    token: string;
    serverUrl: string;
  } | null>(null);
  const [notes, setNotes] = useState<MeetingNotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<string>("");
  const startTimeRef = useRef<number>(0);

  const startMeeting = useCallback(async () => {
    const res = await fetch("/api/token", { method: "POST" });
    const data = await res.json();
    setConnectionDetails(data);
    setAppState("recording");
    startTimeRef.current = Date.now();
    transcriptRef.current = "";
    setError(null);
  }, []);

  const endMeeting = useCallback(async () => {
    const transcript = transcriptRef.current;
    setConnectionDetails(null);

    if (!transcript.trim()) {
      setError("No speech was detected during the meeting.");
      setAppState("idle");
      return;
    }

    setAppState("generating");

    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNotes(data.notes);
      setAppState("notes");
    } catch {
      setError("Failed to generate notes. Please try again.");
      setAppState("idle");
    }
  }, []);

  const resetMeeting = useCallback(() => {
    setAppState("idle");
    setNotes(null);
    setError(null);
    transcriptRef.current = "";
  }, []);

  if (appState === "idle") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center mb-1">
            <svg
              viewBox="0 0 24 24"
              className="w-6 h-6 text-cyan-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Meeting Notes
          </h1>
          <p className="text-zinc-500 text-sm text-center max-w-xs">
            Real-time transcription and AI-generated meeting notes powered by
            Universal-3 Pro
          </p>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={startMeeting}
          className="px-10 py-3 bg-white text-black rounded-full font-medium text-base hover:bg-zinc-200 transition-colors cursor-pointer"
        >
          Start Meeting
        </button>
      </div>
    );
  }

  if (appState === "recording" && connectionDetails) {
    return (
      <LiveKitRoom
        token={connectionDetails.token}
        serverUrl={connectionDetails.serverUrl}
        connect={true}
        audio={true}
        video={true}
        onDisconnected={() => {}}
        className="flex flex-col min-h-screen"
      >
        <MeetingView
          transcriptRef={transcriptRef}
          onEndMeeting={endMeeting}
          startTime={startTimeRef.current}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }

  if (appState === "generating") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="loading-spinner" />
        <p className="text-zinc-400 text-sm">Generating meeting notes...</p>
      </div>
    );
  }

  if (appState === "notes" && notes) {
    return <NotesView notes={notes} onNewMeeting={resetMeeting} />;
  }

  return null;
}

// ── Audio level hook (reused from voice agent) ─────────────

function useAudioLevel(
  audioTrack: ReturnType<typeof useVoiceAssistant>["audioTrack"]
) {
  const [level, setLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const mediaStream = audioTrack?.publication?.track?.mediaStream;
    if (!mediaStream) {
      setLevel(0);
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(mediaStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      setLevel(avg);
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.close();
    };
  }, [audioTrack?.publication?.track?.mediaStream]);

  return level;
}

// ── User transcription via RoomEvent (replaces useTrackTranscription) ──

function useUserTranscription(): Segment[] {
  const room = useRoomContext();
  const [segments, setSegments] = useState<Segment[]>([]);

  useEffect(() => {
    const handler = (
      newSegments: LKTranscriptionSegment[],
      participant: any,
    ) => {
      // Only process transcriptions for the local participant's mic
      if (participant?.identity !== room.localParticipant.identity) return;

      setSegments((prev) => {
        const updated = [...prev];
        for (const seg of newSegments) {
          const idx = updated.findIndex((s) => s.id === seg.id);
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], text: seg.text, final: seg.final };
          } else {
            updated.push({
              id: seg.id,
              text: seg.text,
              firstReceivedTime: seg.firstReceivedTime,
              final: seg.final,
            });
          }
        }
        return updated;
      });
    };

    room.on(RoomEvent.TranscriptionReceived, handler);
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handler);
    };
  }, [room]);

  return segments;
}

// ── Build merged conversation ──────────────────────────────

interface Message {
  role: "user" | "agent";
  text: string;
  timestamp: number;
  final: boolean;
}

interface Segment {
  text: string;
  firstReceivedTime: number;
  id: string;
  final: boolean;
}

function buildConversation(
  agentSegments: Segment[],
  userSegments: Segment[]
): Message[] {
  const all: Message[] = [];

  for (const seg of agentSegments) {
    if (seg.text.trim()) {
      all.push({
        role: "agent",
        text: seg.text,
        timestamp: seg.firstReceivedTime,
        final: seg.final,
      });
    }
  }
  for (const seg of userSegments) {
    if (seg.text.trim()) {
      all.push({
        role: "user",
        text: seg.text,
        timestamp: seg.firstReceivedTime,
        final: seg.final,
      });
    }
  }

  all.sort((a, b) => a.timestamp - b.timestamp);
  return all;
}

// ── Meeting View (Zoom-inspired layout) ────────────────────

function MeetingView({
  transcriptRef,
  onEndMeeting,
  startTime,
}: {
  transcriptRef: React.RefObject<string>;
  onEndMeeting: () => void;
  startTime: number;
}) {
  const { state, audioTrack, agentTranscriptions } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const audioLevel = useAudioLevel(audioTrack);
  const elapsed = useTimer(startTime);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  // Get user transcription via RoomEvent listener
  const userSegments = useUserTranscription();

  // Get user's camera track
  const localCamTrack = localParticipant.getTrackPublications().find(
    (pub) => pub.track?.source === Track.Source.Camera
  );
  const camTrackRef = localCamTrack?.track
    ? {
        participant: localParticipant,
        publication: localCamTrack,
        source: Track.Source.Camera,
      }
    : undefined;

  // Build merged conversation
  const messages = buildConversation(agentTranscriptions, userSegments);

  // Keep transcript ref in sync for notes generation
  useEffect(() => {
    const lines = messages
      .map((m) => `${m.role === "user" ? "User" : "AI Notetaker"}: ${m.text.trim()}`)
      .filter((l) => l.length > 15); // skip near-empty lines
    if (lines.length > 0) {
      transcriptRef.current = lines.join("\n");
    }
  }, [messages, transcriptRef]);

  // Latest caption (most recent non-empty message)
  const latestMessage = [...messages].reverse().find((m) => m.text.trim());

  // Orb state
  const orbClass = [
    "orb orb--small",
    state === "speaking" && "orb--speaking",
    state === "listening" && "orb--listening",
    state === "thinking" && "orb--thinking",
    state === "connecting" && "orb--idle",
  ]
    .filter(Boolean)
    .join(" ");

  const scale = state === "speaking" ? 1 + audioLevel * 0.15 : 1;
  const glow = state === "speaking" ? 20 + audioLevel * 40 : 20;

  // Toggle mic
  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(micMuted);
    setMicMuted(!micMuted);
  }, [localParticipant, micMuted]);

  // Toggle camera
  const toggleCam = useCallback(async () => {
    await localParticipant.setCameraEnabled(camOff);
    setCamOff(!camOff);
  }, [localParticipant, camOff]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/50">
        <h2 className="text-base font-semibold">Meeting Notes</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="recording-dot" />
            <span className="text-red-400 text-xs font-medium uppercase tracking-wider">
              Recording
            </span>
          </div>
          <span className="text-zinc-400 text-sm font-mono">
            {formatTime(elapsed)}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col gap-3 px-6 py-4 overflow-hidden">
        {/* Video Grid */}
        <div className="video-grid">
          {/* User camera tile */}
          <div className="video-tile">
            {camTrackRef && !camOff ? (
              <VideoTrack trackRef={camTrackRef} />
            ) : (
              <div className="video-tile__placeholder">You</div>
            )}
            <span className="video-tile__label">You</span>
          </div>

          {/* AI Notetaker tile */}
          <div className="video-tile">
            <div
              className={orbClass}
              style={{
                transform: `scale(${scale})`,
                boxShadow: `0 0 ${glow}px rgba(94, 200, 242, ${0.2 + audioLevel * 0.3}), 0 0 ${glow * 2}px rgba(94, 200, 242, ${0.08 + audioLevel * 0.15}), inset 0 0 20px rgba(0, 0, 0, 0.4)`,
                transition: "transform 0.1s ease-out, box-shadow 0.1s ease-out",
              }}
            />
            <span className="video-tile__label">AI Notetaker</span>
          </div>
        </div>

        {/* Live Caption Bar */}
        <div className="caption-bar">
          {latestMessage ? (
            <p className="caption-bar__text">
              <span className="caption-bar__speaker">
                {latestMessage.role === "user" ? "You:" : "AI Notetaker:"}
              </span>
              {latestMessage.text}
            </p>
          ) : (
            <p className="caption-bar__text" style={{ color: "#52525b" }}>
              Captions will appear here...
            </p>
          )}
        </div>

        {/* Transcript Panel */}
        <TranscriptPanel messages={messages} />
      </div>

      {/* Control Bar */}
      <div className="control-bar">
        <button
          onClick={toggleMic}
          className={`control-btn ${micMuted ? "control-btn--muted" : "control-btn--default"}`}
          title={micMuted ? "Unmute" : "Mute"}
        >
          {micMuted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button
          onClick={toggleCam}
          className={`control-btn ${camOff ? "control-btn--muted" : "control-btn--default"}`}
          title={camOff ? "Turn on camera" : "Turn off camera"}
        >
          {camOff ? <CamOffIcon /> : <CamIcon />}
        </button>
        <button onClick={onEndMeeting} className="control-btn control-btn--end">
          End Meeting
        </button>
      </div>
    </div>
  );
}

// ── Transcript Panel ───────────────────────────────────────

function TranscriptPanel({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="transcript-panel flex items-center justify-center">
        <p className="text-zinc-600 text-sm italic">
          Transcript will appear here...
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="transcript-panel scrollbar-thin">
      {messages.map((msg, i) => (
          <div key={i} className="transcript-row">
            <span className="transcript-row__time">
              {formatTimestamp(msg.timestamp)}
            </span>
            <span
              className={`transcript-row__speaker ${
                msg.role === "user"
                  ? "transcript-row__speaker--user"
                  : "transcript-row__speaker--agent"
              }`}
            >
              {msg.role === "user" ? "You" : "AI Notetaker"}
            </span>
            <span className={`transcript-row__text${!msg.final ? " transcript-row__text--partial" : ""}`}>{msg.text}</span>
          </div>
        ))}
    </div>
  );
}

// ── Notes View (unchanged) ─────────────────────────────────

function NotesView({
  notes,
  onNewMeeting,
}: {
  notes: MeetingNotes;
  onNewMeeting: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyNotes = useCallback(() => {
    const text = [
      "# Meeting Notes\n",
      "## Summary",
      notes.summary,
      "",
      "## Key Points",
      ...notes.keyPoints.map((p) => `- ${p}`),
      "",
      "## Decisions",
      ...(notes.decisions.length > 0
        ? notes.decisions.map((d) => `- ${d}`)
        : ["- None"]),
      "",
      "## Action Items",
      ...(notes.actionItems.length > 0
        ? notes.actionItems.map((a) => `- ${a}`)
        : ["- None"]),
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [notes]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h2 className="text-lg font-semibold">Meeting Notes</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={copyNotes}
            className="px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-full transition-colors cursor-pointer"
          >
            {copied ? "Copied!" : "Copy notes"}
          </button>
          <button
            onClick={onNewMeeting}
            className="px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-zinc-200 rounded-full transition-colors cursor-pointer"
          >
            New meeting
          </button>
        </div>
      </div>

      {/* Notes content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <NotesSection title="Summary">
            <p className="text-zinc-300 text-sm leading-relaxed">
              {notes.summary}
            </p>
          </NotesSection>

          <NotesSection title="Key Points">
            <ul className="flex flex-col gap-1.5">
              {notes.keyPoints.map((point, i) => (
                <li
                  key={i}
                  className="text-zinc-300 text-sm leading-relaxed flex gap-2"
                >
                  <span className="text-cyan-400 shrink-0">&#8226;</span>
                  {point}
                </li>
              ))}
            </ul>
          </NotesSection>

          {notes.decisions.length > 0 && (
            <NotesSection title="Decisions">
              <ul className="flex flex-col gap-1.5">
                {notes.decisions.map((decision, i) => (
                  <li
                    key={i}
                    className="text-zinc-300 text-sm leading-relaxed flex gap-2"
                  >
                    <span className="text-green-400 shrink-0">&#8226;</span>
                    {decision}
                  </li>
                ))}
              </ul>
            </NotesSection>
          )}

          {notes.actionItems.length > 0 && (
            <NotesSection title="Action Items">
              <ul className="flex flex-col gap-1.5">
                {notes.actionItems.map((item, i) => (
                  <li
                    key={i}
                    className="text-zinc-300 text-sm leading-relaxed flex gap-2"
                  >
                    <span className="text-amber-400 shrink-0">&#9633;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </NotesSection>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .87-.16 1.71-.46 2.49" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h7a2 2 0 0 1 2 2v9.34m-2 3.66" />
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416v-7.13" />
    </svg>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function useTimer(startTime: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  return elapsed;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
