export default function DangerError(message) {
  const error = new Error(message);
  error.name = "DangerError";
  return error;
}
