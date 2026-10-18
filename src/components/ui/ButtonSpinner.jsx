import { ClipLoader } from "react-spinners";

/**
 * ButtonSpinner — compact, lightweight loader for buttons running async actions.
 */
export default function ButtonSpinner({
  size = 14,
  color = "currentColor",
  className = "",
  style = {},
}) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginRight: "6px",
        verticalAlign: "middle",
        ...style,
      }}
      aria-hidden="true"
    >
      <ClipLoader size={size} color={color} speedMultiplier={0.85} />
    </span>
  );
}
