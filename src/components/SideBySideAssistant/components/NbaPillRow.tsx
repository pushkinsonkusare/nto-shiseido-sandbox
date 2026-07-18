import { ArrowUpRightIcon } from "../../icons/StorefrontIcons";

export type NbaPill = {
  id: string;
  label: string;
};

type Props = {
  pills: NbaPill[];
  onSelect: (pill: NbaPill) => void;
};

export function NbaPillRow({ pills, onSelect }: Props) {
  if (pills.length === 0) return null;
  return (
    <div className="sxs-nba-row" role="group" aria-label="Suggested follow-ups">
      {pills.map((pill) => (
        <button
          key={pill.id}
          type="button"
          className="sxs-nba-pill"
          onClick={() => onSelect(pill)}
        >
          <span className="sxs-nba-pill__label">{pill.label}</span>
          <ArrowUpRightIcon
            className="sxs-nba-pill__icon"
            width={16}
            height={16}
          />
        </button>
      ))}
    </div>
  );
}

export default NbaPillRow;
