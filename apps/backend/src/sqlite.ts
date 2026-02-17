// For more information about this file see https://dove.feathersjs.com/guides/cli/databases.html
import knex from 'knex'
import type { Knex } from 'knex'
import type { Application } from './declarations'

declare module './declarations' {
  interface Configuration {
    sqliteClient: Knex
  }
}

export const sqlite = (app: Application) => {
  const config = app.get('sqlite')
  const db = knex(config!)

  app.set('sqliteClient', db)

  void ensureSqliteSchema(db)
}

const ensureSqliteSchema = async (db: Knex) => {
  if (!(await db.schema.hasTable('users'))) {
    await db.schema.createTable('users', (table) => {
      table.increments('id').primary()
      table.string('email').notNullable().unique()
      table.string('password').notNullable()
      table.string('role').notNullable().defaultTo('member')
      table.integer('defaultProjectId').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
    })
  } else {
    if (!(await db.schema.hasColumn('users', 'role'))) {
      await db.schema.alterTable('users', (table) => {
        table.string('role').notNullable().defaultTo('member')
      })
    }
    if (!(await db.schema.hasColumn('users', 'defaultProjectId'))) {
      await db.schema.alterTable('users', (table) => {
        table.integer('defaultProjectId').nullable()
      })
    }
  }

  if (!(await db.schema.hasTable('projects'))) {
    await db.schema.createTable('projects', (table) => {
      table.increments('id').primary()
      table.string('name').notNullable()
      table.integer('ownerUserId').notNullable()
      table.integer('createdBy').nullable()
      table.integer('updatedBy').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
    })
  }

  if (!(await db.schema.hasTable('jobs'))) {
    await db.schema.createTable('jobs', (table) => {
      table.increments('id').primary()
      table.integer('projectId').notNullable()
      table.integer('missionId').nullable()
      table.text('instruction').nullable()
      table.string('type').nullable()
      table.string('status').notNullable().defaultTo('pending')
      table.text('payload').nullable()
      table.text('result').nullable()
      table.text('logs').nullable()
      table.string('workerId').nullable()
      table.timestamp('locked_at').nullable()
      table.timestamp('started_at').nullable()
      table.timestamp('heartbeat_at').nullable()
      table.timestamp('finished_at').nullable()
      table.integer('attempts').notNullable().defaultTo(0)
      table.text('last_error').nullable()
      table.integer('createdBy').nullable()
      table.integer('updatedBy').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
    })
  } else {
    if (!(await db.schema.hasColumn('jobs', 'workerId'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.string('workerId').nullable()
      })
    }
    if (!(await db.schema.hasColumn('jobs', 'locked_at'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.timestamp('locked_at').nullable()
      })
    }
    if (!(await db.schema.hasColumn('jobs', 'started_at'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.timestamp('started_at').nullable()
      })
    }
    if (!(await db.schema.hasColumn('jobs', 'heartbeat_at'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.timestamp('heartbeat_at').nullable()
      })
    }
    if (!(await db.schema.hasColumn('jobs', 'finished_at'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.timestamp('finished_at').nullable()
      })
    }
    if (!(await db.schema.hasColumn('jobs', 'attempts'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.integer('attempts').notNullable().defaultTo(0)
      })
    }
    if (!(await db.schema.hasColumn('jobs', 'last_error'))) {
      await db.schema.alterTable('jobs', (table) => {
        table.text('last_error').nullable()
      })
    }
  }

  if (!(await db.schema.hasTable('settings'))) {
    await db.schema.createTable('settings', (table) => {
      table.increments('id').primary()
      table.integer('projectId').notNullable()
      table.string('key').notNullable()
      table.text('value').nullable()
      table.integer('createdBy').nullable()
      table.integer('updatedBy').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
      table.unique(['projectId', 'key'])
    })
  }

  if (!(await db.schema.hasTable('missions'))) {
    await db.schema.createTable('missions', (table) => {
      table.increments('id').primary()
      table.integer('projectId').notNullable()
      table.string('trigger_type').notNullable().defaultTo('manual')
      table.string('status').notNullable().defaultTo('QUEUED')
      table.text('goal').notNullable()
      table.text('repoUrl').nullable()
      table.string('baseBranch').nullable()
      table.text('latest_user_input').nullable()
      table.text('latest_agent_question').nullable()
      table.timestamp('reviewed_at').nullable()
      table.text('fail_reason').nullable()
      table.text('result_summary').nullable()
      table.text('plan_reasoning').nullable()
      table.timestamp('started_at').nullable()
      table.timestamp('finished_at').nullable()
      table.integer('total_duration_ms').nullable()
      table.integer('token_usage_prompt').nullable().defaultTo(0)
      table.integer('token_usage_completion').nullable().defaultTo(0)
      table.integer('token_usage_total').nullable().defaultTo(0)
      table.string('ai_provider').nullable()
      table.string('ai_model').nullable()
      table.integer('createdBy').nullable()
      table.integer('updatedBy').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
    })
  } else {
    const missionMigrations: Array<{ column: string; builder: (t: any) => void }> = [
      { column: 'latest_user_input', builder: (t) => t.text('latest_user_input').nullable() },
      { column: 'latest_agent_question', builder: (t) => t.text('latest_agent_question').nullable() },
      { column: 'plan_reasoning', builder: (t) => t.text('plan_reasoning').nullable() },
      { column: 'started_at', builder: (t) => t.timestamp('started_at').nullable() },
      { column: 'finished_at', builder: (t) => t.timestamp('finished_at').nullable() },
      { column: 'total_duration_ms', builder: (t) => t.integer('total_duration_ms').nullable() },
      { column: 'token_usage_prompt', builder: (t) => t.integer('token_usage_prompt').nullable().defaultTo(0) },
      { column: 'token_usage_completion', builder: (t) => t.integer('token_usage_completion').nullable().defaultTo(0) },
      { column: 'token_usage_total', builder: (t) => t.integer('token_usage_total').nullable().defaultTo(0) },
      { column: 'ai_provider', builder: (t) => t.string('ai_provider').nullable() },
      { column: 'ai_model', builder: (t) => t.string('ai_model').nullable() }
    ]

    for (const migration of missionMigrations) {
      if (!(await db.schema.hasColumn('missions', migration.column))) {
        await db.schema.alterTable('missions', migration.builder)
      }
    }
  }

  if (!(await db.schema.hasTable('mission_steps'))) {
    await db.schema.createTable('mission_steps', (table) => {
      table.increments('id').primary()
      table.integer('projectId').notNullable()
      table.integer('missionId').notNullable()
      table.integer('order_index').notNullable()
      table.text('description').notNullable()
      table.text('command').nullable()
      table.string('status').notNullable().defaultTo('PENDING')
      table.text('result_summary').nullable()
      table.integer('exit_code').nullable()
      table.integer('retry_count').nullable().defaultTo(0)
      table.integer('max_retries').nullable().defaultTo(0)
      table.boolean('retryable').nullable().defaultTo(false)
      table.integer('timeout_ms').nullable().defaultTo(300000)
      table.integer('duration_ms').nullable()
      table.timestamp('started_at').nullable()
      table.timestamp('finished_at').nullable()
      table.text('stdout_tail').nullable()
      table.text('stderr_tail').nullable()
      table.integer('createdBy').nullable()
      table.integer('updatedBy').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
    })
  } else {
    const stepMigrations: Array<{ column: string; builder: (t: any) => void }> = [
      { column: 'command', builder: (t) => t.text('command').nullable() },
      { column: 'exit_code', builder: (t) => t.integer('exit_code').nullable() },
      { column: 'retry_count', builder: (t) => t.integer('retry_count').nullable().defaultTo(0) },
      { column: 'max_retries', builder: (t) => t.integer('max_retries').nullable().defaultTo(0) },
      { column: 'retryable', builder: (t) => t.boolean('retryable').nullable().defaultTo(false) },
      { column: 'timeout_ms', builder: (t) => t.integer('timeout_ms').nullable().defaultTo(300000) },
      { column: 'duration_ms', builder: (t) => t.integer('duration_ms').nullable() },
      { column: 'started_at', builder: (t) => t.timestamp('started_at').nullable() },
      { column: 'finished_at', builder: (t) => t.timestamp('finished_at').nullable() },
      { column: 'stdout_tail', builder: (t) => t.text('stdout_tail').nullable() },
      { column: 'stderr_tail', builder: (t) => t.text('stderr_tail').nullable() },
      { column: 'background', builder: (t) => t.boolean('background').nullable().defaultTo(false) },
      { column: 'ready_pattern', builder: (t) => t.text('ready_pattern').nullable() }
    ]

    for (const migration of stepMigrations) {
      if (!(await db.schema.hasColumn('mission_steps', migration.column))) {
        await db.schema.alterTable('mission_steps', migration.builder)
      }
    }
  }

  if (!(await db.schema.hasTable('mission_logs'))) {
    await db.schema.createTable('mission_logs', (table) => {
      table.increments('id').primary()
      table.integer('projectId').notNullable()
      table.integer('missionId').notNullable()
      table.integer('stepId').nullable()
      table.string('type').notNullable().defaultTo('thought')
      table.text('content').notNullable()
      table.timestamp('timestamp').defaultTo(db.fn.now())
      table.integer('createdBy').nullable()
      table.integer('updatedBy').nullable()
      table.timestamp('created_at').defaultTo(db.fn.now())
      table.timestamp('updated_at').defaultTo(db.fn.now())
    })
  }
}
