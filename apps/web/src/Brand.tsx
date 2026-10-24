import { Link } from "react-router-dom";

export default function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-icon">
        <img
          src="/brand/lectureloop-mark.svg"
          width={44}
          height={44}
          alt=""
          aria-hidden="true"
        />
      </span>
      <span className="brand-wordmark">
        Lecture<span>Loop</span>
      </span>
    </Link>
  );
}
