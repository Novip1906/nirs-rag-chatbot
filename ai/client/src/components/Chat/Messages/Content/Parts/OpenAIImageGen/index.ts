export { default as ImageGen } from './OpenAIImageGen';
export { default as OpenAIImageGen } from './OpenAIImageGen';
export { default as ImageGeneration } from './ImageGeneration';

export const AGENT_STYLE_TOOLS = new Set([
  'image_gen_oai',
  'image_edit_oai',
  'gemini_image_gen',
  'generate_image',
]);
