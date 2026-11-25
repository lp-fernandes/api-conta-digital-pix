// Os testes sempre usam um banco separado, nunca o de desenvolvimento
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://postgres:postgres@localhost:5432/contadigital_test';
