import {
  publicGetReviewPage,
  publicListDocuments,
  type ReviewClientPage,
  type PublicDocumentSummary,
} from '@/lib/api';
import { ReviewPage } from './ReviewPage';
import { RevokedState } from './RevokedState';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function ReviewTokenPage({ params }: Props) {
  const { token } = await params;
  let page: ReviewClientPage;
  let documents: PublicDocumentSummary[];
  try {
    [page, documents] = await Promise.all([
      publicGetReviewPage(token),
      publicListDocuments(token),
    ]);
  } catch (err) {
    return <RevokedState />;
  }
  return <ReviewPage token={token} initial={page} initialDocuments={documents} />;
}
