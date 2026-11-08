export default function InvalidParameterError(message) {
  const error = new Error(message);
  error.name = "InvalidParameterError";
  return error;
}
