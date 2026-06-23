import { Summary } from '@/types';

export function summaryDataToMarkdown(aiSummary: Summary | null): string {
  if (!aiSummary) return '';

  if ('markdown' in aiSummary && typeof (aiSummary as any).markdown === 'string') {
    return (aiSummary as any).markdown || '';
  }

  return Object.entries(aiSummary)
    .filter(([key]) => (
      key !== 'markdown' &&
      key !== 'summary_json' &&
      key !== '_section_order' &&
      key !== 'MeetingName'
    ))
    .map(([, section]) => {
      if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
        const sectionTitle = `## ${(section as any).title}\n\n`;
        const sectionContent = ((section as any).blocks || [])
          .map((block: any) => `- ${block.content || ''}`)
          .join('\n');
        return sectionTitle + sectionContent;
      }
      return '';
    })
    .filter((section) => section.trim())
    .join('\n\n');
}

export function markdownToSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>*-]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
