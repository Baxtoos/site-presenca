-- Papéis e banco para DESENVOLVIMENTO LOCAL. Roda uma vez, quando o volume é criado.
-- Em produção os papéis são criados pelo provisionamento, com senhas fortes vindas de um cofre.
--
-- app_owner  : dono do schema; só o passo de migration usa este papel.
-- app_api    : a API. Só SELECT/INSERT/UPDATE/DELETE, sujeita a RLS, sem DDL, sem BYPASSRLS.
-- app_worker : o worker. Recebe permissões por tabela nas migrations (Fase 1).
-- app_auth   : SEM LOGIN. Dono das funções SECURITY DEFINER de autenticação (Fase 2), que precisam
--              achar usuário por e-mail e sessão por token antes de se saber quem é o usuário.
--              Recebe só as colunas necessárias, nas migrations.

create role app_owner  login password 'app_owner_dev';
create role app_api    login password 'app_api_dev'    nosuperuser nocreatedb nocreaterole nobypassrls;
create role app_worker login password 'app_worker_dev' nosuperuser nocreatedb nocreaterole nobypassrls;
create role app_auth   nologin                         nosuperuser nocreatedb nocreaterole nobypassrls;
-- Permite que as migrations (app_owner) passem a propriedade das funções de auth para app_auth.
grant app_auth to app_owner;

create database presenca owner app_owner;
revoke connect, temporary on database presenca from public;
grant connect on database presenca to app_api, app_worker;

\connect presenca

-- Ninguém cria objetos no schema public.
revoke all on schema public from public;

create schema app authorization app_owner;
grant usage on schema app to app_api, app_worker, app_auth;

alter role app_owner  in database presenca set search_path = app;
alter role app_api    in database presenca set search_path = app;
alter role app_worker in database presenca set search_path = app;

-- Tabelas criadas pelo app_owner nas migrations já nascem com DML liberado para a API.
-- O RLS (forçado em cada tabela) decide quais linhas a API enxerga.
alter default privileges for role app_owner in schema app
  grant select, insert, update, delete on tables to app_api;
alter default privileges for role app_owner in schema app
  grant usage, select on sequences to app_api;
