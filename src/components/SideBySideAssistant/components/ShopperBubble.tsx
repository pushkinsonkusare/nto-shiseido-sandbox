type Props = {
  text: string;
};

export function ShopperBubble({ text }: Props) {
  return (
    <div className="sxs-shopper-row">
      <div className="sxs-shopper-bubble">{text}</div>
    </div>
  );
}

export default ShopperBubble;
