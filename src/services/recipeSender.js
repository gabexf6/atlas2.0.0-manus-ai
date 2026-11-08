import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { downloadRecipeImage, enhanceRecipeImage } from './tudodelicious.js';

export function formatRecipe(recipe, header = '') {
  const lines = [];

  if (header) {
    lines.push(header);
    lines.push('');
  }

  lines.push(`🍽️ *${recipe.title}*`);

  if (recipe.description) {
    lines.push('');
    lines.push(`_${recipe.description.substring(0, 250)}_`);
  }

  // Mesmo que o site mostra: porções, preparo, dificuldade e categoria.
  // Cozimento/total ficam de fora (o total do site soma o descanso, que não
  // aparece, e parecia errado). Descanso só entra se o site tiver.
  const details = [];
  if (recipe.category) details.push(`🏷️ Categoria: ${recipe.category}`);
  if (recipe.servings) details.push(`🍴 Porções: ${recipe.servings}`);
  if (recipe.prepTime) details.push(`🔪 Preparo: ${recipe.prepTime}`);
  if (recipe.restTime) details.push(`⏳ Descanso: ${recipe.restTime}`);
  if (recipe.difficulty) details.push(`📊 Dificuldade: ${recipe.difficulty}`);

  if (details.length > 0) {
    lines.push('');
    lines.push(...details.map((d) => `• ${d}`));
  }

  if (recipe.url) {
    lines.push('');
    lines.push(`🔗 Ver receita completa:`);
    lines.push(recipe.url);
  }

  return lines.join('\n');
}

function removeQuietly(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

// Manda a receita (com foto, se tiver) pra um chat. Usado pelo /receita e
// pelos envios automáticos nos grupos cadastrados.
export async function sendRecipe(socket, remoteJid, recipe, { header = '' } = {}) {
  const text = formatRecipe(recipe, header);

  if (!recipe.image) {
    await socket.sendMessage(remoteJid, { text });
    return;
  }

  const tempDir = path.resolve('assets', 'temp', 'recipes');
  let imagePath = null;
  let enhancedPath = null;

  try {
    const imgResult = await downloadRecipeImage(recipe.image, tempDir);
    imagePath = imgResult.filePath;

    const enhancedId = crypto.randomBytes(4).toString('hex');
    enhancedPath = path.join(tempDir, `enhanced_${enhancedId}.jpg`);
    await enhanceRecipeImage(imagePath, enhancedPath);

    const finalPath = fs.existsSync(enhancedPath) ? enhancedPath : imagePath;
    const buffer = fs.readFileSync(finalPath);

    await socket.sendMessage(remoteJid, {
      image: buffer,
      caption: text.substring(0, 1024),
      mimetype: 'image/jpeg',
    });

    if (text.length > 1024) {
      await socket.sendMessage(remoteJid, { text: text.substring(1024) });
    }
  } catch (imgErr) {
    console.error('⚠️ Erro na imagem:', imgErr.message);
    await socket.sendMessage(remoteJid, { text });
  } finally {
    removeQuietly(imagePath);
    removeQuietly(enhancedPath);
  }
}
