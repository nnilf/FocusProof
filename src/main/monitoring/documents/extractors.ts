import mammoth from 'mammoth';

/** Extracts plain text from a .docx file in memory. Formatting and images are ignored. */
export async function extractText(path: string): Promise<string> {
  const result = await mammoth.extractRawText({ path });
  return result.value;
}
