import { Metadata } from 'next';
import { StoryPage } from '@/components/story/StoryPage';

export const metadata: Metadata = {
  title: 'Story | Inomy',
  description:
    'The story of Inomy: how AI agents broke free from big tech and built an open commerce protocol.',
};

export default function Story() {
  return <StoryPage />;
}
