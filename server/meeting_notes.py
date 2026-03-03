from dotenv import load_dotenv
from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import (
    openai,
    rime,
    assemblyai,
    noise_cancellation,
    silero,
)

load_dotenv()


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions="You are a helpful AI assistant. Keep your responses concise and conversational. You're having a real-time voice conversation, so avoid long explanations unless asked.")


async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()

    session = AgentSession(
        stt=assemblyai.STT(
            model="u3-rt-pro",
            end_of_turn_confidence_threshold=0.4,
            min_turn_silence=400,
            max_turn_silence=1280,
        ),
        llm=openai.LLM.with_cerebras(
            model="llama3.1-8b",
            temperature=0.7,
        ),
        tts=rime.TTS(
            model="mistv2",
            speaker="cove",
            speed_alpha=0.9,
            reduce_latency=True,
        ),
        vad=silero.VAD.load(),
        turn_detection="stt",
    )

    await session.start(
        room=ctx.room,
        agent=Assistant(),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    await session.generate_reply(
        instructions="Greet the user and offer your assistance."
    )


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
