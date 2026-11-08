export default function WarningError(message) {
  const error = new Error(message);
  error.name = "WarningError";
  return error;
}
