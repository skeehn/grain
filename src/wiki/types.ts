export type WikiPageType = 'architecture' | 'subsystem' | 'api' | 'data-flow' | 'operational' | 'decision' | 'glossary' | 'troubleshooting';

export interface WikiSource { path: string; start_line: number; end_line: number; symbol?: string; hash: string }
export interface WikiPage {
  id: string;
  title: string;
  type: WikiPageType;
  status: 'current' | 'stale' | 'draft';
  owners: string[];
  tags: string[];
  source_commit: string;
  generated_at: string;
  sources: WikiSource[];
  body: string;
  path: string;
}
