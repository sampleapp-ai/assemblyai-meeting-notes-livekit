import logging

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import AgentSession, Agent
from livekit.plugins import (
    openai,
    rime,
    assemblyai,
    silero,
)

load_dotenv()

logger = logging.getLogger("meeting-notes")

# Meeting-specific terms for recognition boost
KEYTERMS = [
    "action items",
    "next steps",
    "follow up",
    "deadline",
    "milestone",
    "deliverable",
    "stakeholder",
    "budget",
    "quarterly review",
    "roadmap",
    "AssemblyAI",
    "Universal-3 Pro",
]

SYSTEM_INSTRUCTIONS = (
    "You are a helpful AI meeting facilitator. You participate in meetings by "
    "listening to discussion, asking clarifying questions, and helping keep the "
    "conversation on track.\n\n"

    "Your role:\n"
    "- Help summarize discussion points when asked\n"
    "- Ask clarifying questions if something is ambiguous\n"
    "- Remind participants of agenda items or time constraints\n"
    "- Offer to capture action items and decisions\n"
    "- Keep responses concise — you're in a live meeting, not writing an essay\n\n"

    "Keep your responses short and conversational. Your output will be converted "
    "to audio so don't include special characters, markdown formatting, or long "
    "lists in your answers. Speak naturally as a meeting participant would."
)


class MeetingFacilitator(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_INSTRUCTIONS)


async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()

    session = AgentSession(
        stt=assemblyai.STT(
            min_turn_silence=560,
            max_turn_silence=2000,
            keyterms_prompt=KEYTERMS,
        ),
        llm=openai.LLM.with_cerebras(
            model="llama3.1-8b",
            temperature=0.7,
        ),
        tts=rime.TTS(
            model="mistv2",
            speaker="astra",
            speed_alpha=1.0,
            reduce_latency=True,
        ),
        vad=silero.VAD.load(),
        turn_detection="stt",
    )

    await session.start(
        room=ctx.room,
        agent=MeetingFacilitator(),
    )

    await session.generate_reply(
        instructions="Briefly introduce yourself as an AI meeting facilitator. Say you're here to help keep the meeting on track and capture key points. Ask what's on the agenda today."
    )


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
