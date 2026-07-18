import { useState, type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontalIcon } from "../../icons/StorefrontIcons";

type Props = {
  placeholder?: string;
  disabled?: boolean;
  onSubmit: (text: string) => void;
};

export function FooterInput({
  placeholder = "Type your message...",
  disabled = false,
  onSubmit,
}: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="sxs-assistant__footer" onSubmit={handleSubmit}>
      <div className="sxs-assistant__input-shell">
        <input
          type="text"
          className="sxs-assistant__input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="Ask the personal assistant"
        />
        <button
          type="submit"
          className="sxs-assistant__send"
          aria-label="Send message"
          disabled={disabled || !value.trim()}
        >
          <SendHorizontalIcon width={20} height={20} />
        </button>
      </div>
    </form>
  );
}

export default FooterInput;
