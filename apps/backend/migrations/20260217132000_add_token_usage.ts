import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
    await knex.schema.table('missions', (table) => {
        table.json('token_usage').nullable()
    })
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.table('missions', (table) => {
        table.dropColumn('token_usage')
    })
}
