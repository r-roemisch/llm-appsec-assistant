import { lazy } from "react";
import { Route, Routes } from "react-router";

import { RequireSession } from "@/components/common/RequireSession";
import { UnauthorizedListener } from "@/components/common/UnauthorizedListener";
import { AppShell } from "@/components/shell/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConversationPage } from "@/pages/ConversationPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

// Rarely visited pages load on demand.
const AccountPage = lazy(() => import("@/pages/AccountPage").then((module) => ({ default: module.AccountPage })));
const AdminPage = lazy(() => import("@/pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));
const ProfilePage = lazy(() => import("@/pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const TargetsPage = lazy(() => import("@/pages/TargetsPage").then((module) => ({ default: module.TargetsPage })));
const HelpPage = lazy(() => import("@/pages/HelpPage").then((module) => ({ default: module.HelpPage })));
const ReportsPage = lazy(() => import("@/pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const ReportPage = lazy(() => import("@/pages/ReportPage").then((module) => ({ default: module.ReportPage })));

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <UnauthorizedListener />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireSession />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<ConversationPage />} />
            <Route path="/c/:id" element={<ConversationPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/targets" element={<TargetsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:id" element={<ReportPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  );
}
