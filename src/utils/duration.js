/**
 * Converte uma duração no formato HH:MM:SS ou MM:SS
 * para segundos.
 */
export function parseDuration(duration) {
  if (!duration || typeof duration !== "string") {
    return null;
  }

  const parts = duration.trim().split(":");

  if (
    parts.length < 2 ||
    parts.length > 3 ||
    !parts.every((part) => /^\d+$/.test(part))
  ) {
    return null;
  }

  const numbers = parts.map(Number);

  if (parts.length === 3) {
    const [hours, minutes, seconds] = numbers;

    if (minutes > 59 || seconds > 59) {
      return null;
    }

    return hours * 3600 + minutes * 60 + seconds;
  }

  const [minutes, seconds] = numbers;

  if (seconds > 59) {
    return null;
  }

  return minutes * 60 + seconds;
}

/**
 * Limite máximo de duração: 5 horas.
 */
export function isDurationTooLong(duration) {
  const seconds = parseDuration(duration);

  // Se a duração não for reconhecida, não bloqueia por duração.
  if (seconds === null) {
    return false;
  }

  return seconds > 5 * 60 * 60;
}