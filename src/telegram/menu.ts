// Shared by setup and standalone command-menu refreshes; owner-chat scope only.
export const botCommands = [
  { command: 'journal', description: 'Start or resume a draft for today' },
  { command: 'done', description: 'Prepare a preview before saving' },
  { command: 'preview', description: 'Read the current preview' },
  { command: 'save', description: 'Approve and save the reviewed preview' },
  { command: 'regenerate', description: 'Try a fresh AI version' },
  { command: 'revise', description: 'How to request an AI wording change' },
  { command: 'continue', description: 'Continue writing your draft' },
  { command: 'date', description: 'How to select a past journal date' },
  { command: 'status', description: 'Check the selected draft' },
  { command: 'today', description: 'Open the latest saved entry for today' },
  { command: 'history', description: 'Recent saved journal links' },
  { command: 'ai_on', description: 'Enable AI after reviewing privacy' },
  { command: 'ai_off', description: 'Stop future AI processing' },
  { command: 'settings', description: 'Check AI and reminder settings' },
  { command: 'cancel', description: 'Cancel an unfinished draft with confirmation' },
  { command: 'privacy', description: 'Storage and AI privacy' },
  { command: 'id', description: 'Your Telegram account ID' },
  { command: 'help', description: 'All journal commands and usage' },
  { command: 'start', description: 'Welcome and journal controls' }
];
