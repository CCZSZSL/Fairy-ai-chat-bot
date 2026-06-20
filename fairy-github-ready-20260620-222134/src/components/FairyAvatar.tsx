interface FairyAvatarProps {
  mood: "idle" | "thinking" | "speaking" | "listening" | "watching" | "error";
  speaking: boolean;
  listening: boolean;
}

export function FairyAvatar({ mood, speaking, listening }: FairyAvatarProps) {
  return (
    <div className={`fairy-stage ${mood} ${speaking ? "is-speaking" : ""} ${listening ? "is-listening" : ""}`}>
      <div className="wing wing-left" />
      <div className="wing wing-right" />
      <div className="fairy-body">
        <div className="hair" />
        <div className="face">
          <span className="eye eye-left" />
          <span className="eye eye-right" />
          <span className="mouth" />
        </div>
        <div className="torso" />
      </div>
      <div className="pulse-ring ring-one" />
      <div className="pulse-ring ring-two" />
    </div>
  );
}
