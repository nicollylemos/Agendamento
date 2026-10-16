import { Link } from 'react-router';
import { LayoutAcesso } from '../layouts/LayoutAcesso';

export function NaoEncontrada() {
  return (
    <LayoutAcesso titulo="Página não encontrada" descricao="O endereço pode estar errado ou a página foi removida.">
      <Link to="/painel" className="text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
        Ir para o painel
      </Link>
    </LayoutAcesso>
  );
}
