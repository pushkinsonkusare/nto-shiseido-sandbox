type Props = {
  imageUrl: string;
  imageAlt?: string;
  greeting?: string;
  body: string;
};

export function GreetingCard({
  imageUrl,
  imageAlt = "",
  greeting = "Hello!",
  body,
}: Props) {
  return (
    <article className="sxs-greeting" aria-label="Personal Assistant greeting">
      <div className="sxs-greeting__hero">
        <img
          className="sxs-greeting__hero-img"
          src={imageUrl}
          alt={imageAlt}
        />
      </div>
      <div className="sxs-greeting__body">
        <h2 className="sxs-greeting__title">{greeting}</h2>
        <p className="sxs-greeting__copy">{body}</p>
      </div>
    </article>
  );
}

export default GreetingCard;
