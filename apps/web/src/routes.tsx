import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import { useAuth } from './auth/AuthContext';
import { Carregando } from './components/ui';
import { LayoutPainel } from './layouts/LayoutPainel';
import { Login } from './pages/public/Login';
import { AceitarConvite, EsqueciSenha, RedefinirSenha } from './pages/public/Senha';
import { Inicio } from './pages/admin/Inicio';
import { Empresa } from './pages/admin/Empresa';
import { Servicos } from './pages/admin/Servicos';
import { Equipe } from './pages/admin/Equipe';
import { Horarios } from './pages/admin/Horarios';
import { Pagamentos } from './pages/admin/Pagamentos';
import { Estoque } from './pages/admin/Estoque';
import { Fidelidade } from './pages/admin/Fidelidade';
import { Relatorios } from './pages/admin/Relatorios';
import { Instagram } from './pages/admin/Instagram';
import { NaoFuiEu } from './pages/public/NaoFuiEu';
import { MeusHorarios } from './pages/staff/MeusHorarios';
import { MinhaConta } from './pages/staff/MinhaConta';
import { Agenda } from './pages/agenda/Agenda';
import { Agendar } from './pages/public/Agendar';
import { Site } from './pages/public/Site';
import { Personalizacao } from './pages/admin/Personalizacao';
import { MeuAgendamento } from './pages/public/MeuAgendamento';
import { MeusAgendamentos } from './pages/public/MeusAgendamentos';
import { NaoEncontrada } from './pages/NaoEncontrada';

function ExigeLogin({ children }: { children: ReactNode }) {
  const { estado } = useAuth();
  const local = useLocation();
  if (estado.status === 'carregando') return <Carregando texto="Abrindo o painel…" />;
  if (estado.status === 'anonimo') return <Navigate to="/login" replace state={{ voltarPara: local.pathname }} />;
  return children;
}

// Esconde a tela de quem não tem permissão. A API barra de qualquer forma (9.2).
function ExigePermissao({ permissao, children }: { permissao: string; children: ReactNode }) {
  const { pode } = useAuth();
  // 'a|b' = basta ter uma das duas
  return permissao.split('|').some(pode) ? children : <Navigate to="/painel" replace />;
}

export const router = createBrowserRouter([
  // Site do cliente (a landing page entra na Fase 9)
  { path: '/', element: <Site /> }, // RF09
  { path: '/agendar', element: <Agendar /> },
  { path: '/meu-agendamento', element: <MeuAgendamento /> },
  { path: '/meus-agendamentos', element: <MeusAgendamentos /> },
  { path: '/login', element: <Login /> },
  { path: '/esqueci-senha', element: <EsqueciSenha /> },
  { path: '/redefinir-senha', element: <RedefinirSenha /> },
  { path: '/convite', element: <AceitarConvite /> },
  { path: '/seguranca/nao-fui-eu', element: <NaoFuiEu /> },
  {
    path: '/painel',
    element: (
      <ExigeLogin>
        <LayoutPainel />
      </ExigeLogin>
    ),
    children: [
      { index: true, element: <Inicio /> },
      { path: 'empresa', element: <ExigePermissao permissao="empresa:gerenciar"><Empresa /></ExigePermissao> },
      { path: 'servicos', element: <ExigePermissao permissao="servicos:gerenciar"><Servicos /></ExigePermissao> },
      { path: 'equipe', element: <ExigePermissao permissao="usuarios:gerenciar"><Equipe /></ExigePermissao> },
      { path: 'horarios', element: <ExigePermissao permissao="horarios:gerenciar"><Horarios /></ExigePermissao> },
      { path: 'estoque', element: <ExigePermissao permissao="estoque:ver"><Estoque /></ExigePermissao> },
      { path: 'site', element: <ExigePermissao permissao="empresa:gerenciar"><Personalizacao /></ExigePermissao> },
      { path: 'fidelidade', element: <ExigePermissao permissao="fidelidade:gerenciar"><Fidelidade /></ExigePermissao> },
      { path: 'pagamentos', element: <ExigePermissao permissao="sinal:gerenciar"><Pagamentos /></ExigePermissao> },
      { path: 'instagram', element: <ExigePermissao permissao="marketing:gerenciar"><Instagram /></ExigePermissao> },
      { path: 'instagram/:id', element: <ExigePermissao permissao="marketing:gerenciar"><Instagram /></ExigePermissao> },
      { path: 'relatorios', element: <ExigePermissao permissao="relatorios:ver|relatorios:ver_proprios"><Relatorios /></ExigePermissao> }, // RF47–RF55
      { path: 'agenda', element: <ExigePermissao permissao="agenda:ver_propria"><Agenda /></ExigePermissao> },
      { path: 'meus-horarios', element: <MeusHorarios /> },
      { path: 'conta', element: <MinhaConta /> },
    ],
  },
  { path: '*', element: <NaoEncontrada /> },
]);
