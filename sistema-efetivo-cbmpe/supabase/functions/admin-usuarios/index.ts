// Edge Function: criação de usuários e redefinição de senha (somente ADMIN).
// Publicar com:  supabase functions deploy admin-usuarios
// A chave service_role fica só no servidor (variável SUPABASE_SERVICE_ROLE_KEY, já injetada pelo Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PAPEIS = ['ADMIN', 'DGP', 'LEITOR_GERAL', 'GESTOR', 'LEITOR'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const servico = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    // quem está chamando?
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: quem, error: eQuem } = await servico.auth.getUser(token);
    if (eQuem || !quem.user) return resp({ erro: 'Não autenticado.' }, 401);
    const { data: perfil } = await servico.from('perfil').select('papel, ativo').eq('id', quem.user.id).single();
    if (!perfil?.ativo || perfil.papel !== 'ADMIN') return resp({ erro: 'Apenas o administrador pode gerenciar usuários.' }, 403);

    const corpo = await req.json();
    if (corpo.acao === 'criar') {
      const email = String(corpo.email || '').trim().toLowerCase();
      const senha = String(corpo.senha || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp({ erro: 'E-mail inválido.' }, 400);
      if (senha.length < 10) return resp({ erro: 'Senha provisória muito curta.' }, 400);
      const p = corpo.perfil || {};
      if (!PAPEIS.includes(p.papel)) return resp({ erro: 'Perfil de acesso inválido.' }, 400);

      const { data: novo, error } = await servico.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome: p.nome || null },
      });
      if (error) return resp({ erro: /already/i.test(error.message) ? 'Já existe usuário com este e-mail.' : error.message }, 400);

      // o gatilho ao_criar_usuario já criou o perfil (inativo); completamos aqui
      const { error: e2 } = await servico.from('perfil').upsert({
        id: novo.user.id, email, nome: p.nome || null, posto: p.posto || null, matricula: p.matricula || null,
        telefone: p.telefone || null, papel: p.papel, pode_ver_saude: !!p.pode_ver_saude, ativo: p.ativo !== false,
        deve_trocar_senha: true,
      });
      if (e2) return resp({ erro: e2.message }, 400);
      const omes: number[] = Array.isArray(corpo.omes) ? corpo.omes.map(Number).filter(Boolean) : [];
      if (omes.length) {
        const { error: e3 } = await servico.from('perfil_ome').insert(omes.map((o) => ({ perfil_id: novo.user.id, ome_id: o })));
        if (e3) return resp({ erro: e3.message }, 400);
      }
      return resp({ ok: true, id: novo.user.id });
    }

    if (corpo.acao === 'redefinir_senha') {
      const senha = String(corpo.senha || '');
      if (senha.length < 10) return resp({ erro: 'Senha provisória muito curta.' }, 400);
      const { error } = await servico.auth.admin.updateUserById(String(corpo.id), { password: senha });
      if (error) return resp({ erro: error.message }, 400);
      await servico.from('perfil').update({ deve_trocar_senha: true }).eq('id', corpo.id);
      return resp({ ok: true });
    }

    return resp({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return resp({ erro: String((e as Error)?.message || e) }, 500);
  }
});
