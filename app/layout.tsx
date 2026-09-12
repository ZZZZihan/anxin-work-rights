import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_SITE_URL || 'https://anxin-work-rights.grassy-betta-1232.chatgpt.site',
);

export const metadata: Metadata = {
  metadataBase,
  title: '安薪乐业｜劳动权益行动工作台',
  description:
    '把劳动争议整理成可执行的下一步：案件、证据、咨询记录与文书草稿集中管理。',
  applicationName: '安薪乐业',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: '安薪乐业｜让劳动维权每一步都有依据',
    description: '案件、证据、咨询记录与文书草稿集中管理。',
    type: 'website',
    locale: 'zh_CN',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '安薪乐业劳动权益行动工作台',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '安薪乐业｜劳动权益行动工作台',
    description: '让劳动维权每一步都有依据。',
    images: ['/og.png'],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
  themeColor: '#15304f',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
