import LoadingAnimation from "../LoadingAnimation";

/**
 * ButtonSpinner — compact, lightweight loader for buttons running async actions.
 * Powered by LoadingAnimation with a compact size.
 */
export default function ButtonSpinner({
  size = 16,
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
      <LoadingAnimation size={size} />
    </span>
  );
}
