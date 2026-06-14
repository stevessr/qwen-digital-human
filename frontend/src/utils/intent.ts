import type { AvatarIntent } from '@/types/avatar'

/**
 * Normalize text for intent detection
 */
function normalizeIntentText(text: string): string {
  return String(text || '').trim().replace(/\s+/g, ' ')
}

/**
 * Detect avatar intents from user text
 * Returns array of detected intents (expressions, motions, persona switches)
 */
export function detectAvatarIntents(text: string): AvatarIntent[] {
  const normalized = normalizeIntentText(text)
  if (!normalized) return []

  const compact = normalized.replace(/\s+/g, '')
  const lower = normalized.toLowerCase()
  const intents: AvatarIntent[] = []

  // Persona switch cycle
  if (
    /切换.*形象|换.*形象|形象.*切换|切换头像|换头像|切换角色|换角色|下一个形象|换一个|切到下一个/.test(
      compact
    )
  ) {
    intents.push({ kind: 'switch_persona_cycle', label: '切换形象' })
  }

  // Specific persona switch
  if (/专业|稳重|讲解|导览|地图讲解|professional|guide/.test(compact) || /professional|guide/.test(lower)) {
    intents.push({ kind: 'switch_persona', personaKey: 'professional', label: '专业导览员' })
  } else if (/活泼|元气|俏皮|灵动|元气满满|energetic/.test(compact) || /energetic/.test(lower)) {
    intents.push({ kind: 'switch_persona', personaKey: 'energetic', label: '元气助手' })
  } else if (/亲和|默认|地图助手|清新|自然|guide/.test(compact) || /default/.test(lower)) {
    intents.push({ kind: 'switch_persona', personaKey: 'guide', label: '地图讲解员' })
  }

  // Expressions
  if (
    /开心|高兴|快乐|太好了|真棒|赞|喜欢|谢谢|鼓励|好耶|smile|happy|cheerful/.test(compact) ||
    /\b(?:smile|happy|cheerful)\b/.test(lower)
  ) {
    intents.push({
      kind: 'expression',
      expression: 'happy',
      motion: 'tap_body',
      label: '开心',
    })
  }

  if (
    /思考|考虑|想想|分析|推理|让我想想|嗯嗯?|think|thinking|ponder/.test(compact) ||
    /\bthink(ing)?\b/.test(lower)
  ) {
    intents.push({
      kind: 'expression',
      expression: 'thinking',
      motion: 'idle',
      label: '思考',
    })
  }

  if (
    /惊讶|震惊|哇|诶|真的吗|居然|天啊|好神奇|wow|surprised|surprise/.test(compact) ||
    /\bsurpris(ed|e)?\b/.test(lower)
  ) {
    intents.push({
      kind: 'expression',
      expression: 'surprised',
      motion: 'flick_head',
      label: '惊讶',
    })
  }

  if (
    /难过|伤心|抱歉|糟糕|遗憾|可惜|sad|sorry|disappointed/.test(compact) ||
    /\bsad\b/.test(lower)
  ) {
    intents.push({
      kind: 'expression',
      expression: 'sad',
      motion: 'pinch_in',
      label: '难过',
    })
  }

  if (
    /生气|讨厌|烦|气死|愤怒|angry|mad|annoyed/.test(compact) ||
    /\b(?:angry|mad|annoyed)\b/.test(lower)
  ) {
    intents.push({
      kind: 'expression',
      expression: 'angry',
      motion: 'shake',
      label: '生气',
    })
  }

  // Motions
  if (/你好|hello|hi|欢迎|早上好|晚上好|打招呼/.test(lower)) {
    intents.push({ kind: 'motion', motion: 'flick_head', label: '打招呼' })
  }

  if (
    /点头|明白|收到|ok|好的|没问题|nod|gotit|roger/.test(compact) ||
    /\bok\b/.test(lower)
  ) {
    intents.push({ kind: 'motion', motion: 'tap_body', label: '确认' })
  }

  return intents
}

/**
 * Composable for avatar intent detection and triggering
 */
export function useAvatarIntent() {
  const detectIntents = (text: string) => {
    return detectAvatarIntents(text)
  }

  return {
    detectIntents,
  }
}
