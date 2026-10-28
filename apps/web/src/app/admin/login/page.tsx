import React from 'react';
import { LoginForm } from '../../../components/admin-forms';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administrator sign-in', robots: { index: false, follow: false } };
export default function LoginPage() {
  return <div className="page-stack"><h1>Administrator sign-in</h1><p>Source review and historical reruns are restricted to Brian’s configured administrator account.</p><LoginForm /></div>;
}
