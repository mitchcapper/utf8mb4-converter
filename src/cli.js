// Copyright (c) 2016, David M. Lee, II

import _ from 'lodash';
import _knex from 'knex';
import { Command } from 'commander';
import read from 'read';

const { name, version } = require('../package.json');
const program = new Command();

// interface TableSpec {
// database: string;
// table: string;
// }

// interface ColumnSpec extends TableSpec {
// column: string;
// }

/** @type {string[]} */
const databasesToSkip = [
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
];

/** @type {{database: string, table: string}[]} */
const tablesToSkip = [];

/** @type {{database: string, table: string, column: string}[]} */
const columnsToSkip = [];

/** @type {string[]} */
const databasesToLimit = [];

function skip(spec) {
  const split = spec.split(/\./);
  if (split.length < 1 || split.length > 3) {
    console.error(`${name}: Invalid --skip ${spec}`);
    process.exit(1);
  }

  const [database, table, column] = split;

  if (column) {
    columnsToSkip.push({ database, table, column });
  } else if (table) {
    tablesToSkip.push({ database, table });
  } else {
    databasesToSkip.push(database);
  }
}

program.version(version)
  .option('-h --host [host]', 'MySQL server to connect to [localhost]', 'localhost')
  .option('-u --user [user]', 'User to connect with [root]', 'root')
  .option('-p --password [passwd]', 'Use or prompt for password')
  .option('-v --verbose', 'Log more details')
  .option('   --skip [database[.table[.column]]]',
    'Skip conversion of the database/table/column', skip)
  .option('   --limit [database]', 'Limit to given database', d => databasesToLimit.push(d))
  .option('   --make-it-so', 'Execute DDL in addition to printing it out')
  .option('   --force-latin1', 'Force conversions of latin1 data')
  .option('   --bulk-table', 'Use ALTER TABLE ... CONVERT TO CHARACTER SET for each table rather than the columns individually')
  .option('   --myisam-to-innodb', 'Convert all MyISAM tables to InnoDB before charset conversion');
program.on('--help', () => {
  console.log('The --force-latin1 conversion assumes that only ASCII characters are in latin1');
  console.log('columns. Any international characters in latin1 columns will be corrupted.');
  console.log();
  console.log('If --password is not given, then no password is used.');
  console.log('The --password may option may optionally specify the password, but putting');
  console.log('passwords on the command line are not recommended.');
});

// console.log(`Parsing arguments from: ${JSON.stringify(process.argv)}`);
program.parse(process.argv);
// console.log(`Parsed options: ${JSON.stringify(program.opts())}`);

function commentOut(arg) {
  return arg.split(/\n/)
    .map((line, index) => index === 0 ? line : `-- ${line}`)
    .join('\n');
}

function debug(...args) {
  const options = program.opts();
  if (options.verbose) {
    const commented = _.map(args, commentOut);
    commented.unshift('--');
    console.log.apply(null, commented);
  }
}

const options = program.opts();
const CharsetsToConvert = options.forceLatin1 ? ['utf8', 'latin1', 'utf8mb3'] : ['utf8','utf8mb3'];

debug('settings', JSON.stringify(_.pick(options, ['host', 'user', 'forceLatin1', 'makeItSo'])));

async function go() {
  const options = program.opts();
  let password = options.password;

  if (process.env.MYSQL_PWD) {
    password = process.env.MYSQL_PWD;
  }
  if (!_.isUndefined(password) && !_.isString(password)) {
    password = await new Promise((resolve, reject) => {
      read({
        prompt: 'Password:',
        silent: true,
        terminal: true // Added for compatibility with modern `read` versions
      }, (err, res) => {
        if (err) { return reject(err); }
        resolve(res);
      });
    });
  }

  const knex = _knex({
    client: 'mysql',
    connection: {
      host: options.host,
      user: options.user,
      password: password,
      database: 'mysql',
    },
  });

  function time(p) {
    const start = process.hrtime();
    const end = () => {
      const diff = process.hrtime(start);
      debug(`${diff[0] * 1000 + diff[1] / 1000000} ms`);
    };
    return p.then(v => {
      end();
      return v;
    }, err => {
      end();
      return Promise.reject(err);
    });
  }

  function alter(ddl) {
    console.log(`${ddl.replace(/\s+/g, ' ').trim()}`);
    const options = program.opts();
    if (options.makeItSo) {
      return time(knex.schema.raw(ddl));
    }
  }

  function select(query) {
    debug(query.toString());
    return time(query.select());
  }

  let dbQuery = knex('information_schema.SCHEMATA')
      .where('SCHEMA_NAME', 'not in', databasesToSkip); // Use actual column name: SCHEMA_NAME
  if (!_.isEmpty(databasesToLimit)) { dbQuery = dbQuery.whereIn('SCHEMA_NAME', databasesToLimit); }
  let databases = await select(dbQuery
    .where('DEFAULT_CHARACTER_SET_NAME', 'in', CharsetsToConvert)
    .columns('SCHEMA_NAME'));
  databases = _.map(databases, 'SCHEMA_NAME');

  debug(`Altering ${databases.length} databases`);
  for (const db of databases) {
    await alter(`
      ALTER DATABASE \`${db}\`
        CHARACTER SET = utf8mb4
        COLLATE = utf8mb4_0900_ai_ci`);
  }

  // Convert MyISAM tables to InnoDB if requested
  if (options.myisamToInnodb) {
    debug('Converting MyISAM tables to InnoDB');
    let myisamQuery = knex('information_schema.TABLES')
      .where('ENGINE', 'MyISAM')
      .where('TABLE_SCHEMA', 'not in', databasesToSkip);
    if (!_.isEmpty(databasesToLimit)) {
      myisamQuery = myisamQuery.whereIn('TABLE_SCHEMA', databasesToLimit);
    }
    for (const tableToSkip of tablesToSkip) {
      myisamQuery = myisamQuery.whereNot(function() {
        this.where({ 'TABLE_SCHEMA': tableToSkip.database, 'TABLE_NAME': tableToSkip.table });
      });
    }
    const myisamTables = await select(myisamQuery.columns('TABLE_SCHEMA', 'TABLE_NAME'));
    debug(`Found ${myisamTables.length} MyISAM tables`);
    for (const table of myisamTables) {
      await alter(`ALTER TABLE \`${table.TABLE_SCHEMA}\`.\`${table.TABLE_NAME}\` ENGINE=InnoDB`);
    }
  }

  let tableQuery = knex('information_schema.COLLATION_CHARACTER_SET_APPLICABILITY as CCSA')
    .join('information_schema.TABLES as T', 'CCSA.COLLATION_NAME', 'T.TABLE_COLLATION') // Use actual column names
    .where('T.TABLE_SCHEMA', 'not in', databasesToSkip); // Use actual column name: T.TABLE_SCHEMA
  for (const tableToSkip of tablesToSkip) {
    tableQuery = tableQuery.whereNot(function() {
      this.where({ 'T.TABLE_SCHEMA': tableToSkip.database, 'T.TABLE_NAME': tableToSkip.table }); // Use actual column names
    });
  }
  if (!_.isEmpty(databasesToLimit)) { // Apply databasesToLimit to tableQuery
    tableQuery = tableQuery.whereIn('T.TABLE_SCHEMA', databasesToLimit);
  }
  const tables = await select(
    tableQuery
      .where('CCSA.CHARACTER_SET_NAME', 'in', CharsetsToConvert) // Use actual column name
      .where('T.TABLE_TYPE', 'BASE TABLE') // Use actual column name
      .columns('T.TABLE_SCHEMA', 'T.TABLE_NAME')); // Select TABLE_SCHEMA and TABLE_NAME directly
  debug(`Altering ${tables.length} tables`);
  if (options.bulkTable) {
    for (const table of tables) {
      await alter(`
        ALTER TABLE \`${table.TABLE_SCHEMA}\`.\`${table.TABLE_NAME}\`
        CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    }
  } else {
    for (const table of tables) {
      await alter(`
        ALTER TABLE \`${table.TABLE_SCHEMA}\`.\`${table.TABLE_NAME}\`
        DEFAULT CHARACTER SET utf8mb4
        COLLATE utf8mb4_0900_ai_ci`);
    }
  }

  // base query for finding the columns we want to convert
  let columnQuery = knex('information_schema.COLUMNS as C')
    .where('C.TABLE_SCHEMA', 'not in', databasesToSkip) // Use actual column name
    .where('C.CHARACTER_SET_NAME', 'in', CharsetsToConvert); // Use actual column name
  for (const tableToSkip of tablesToSkip) {
    columnQuery = columnQuery.whereNot(function() {
      this.where({ 'C.TABLE_SCHEMA': tableToSkip.database, 'C.TABLE_NAME': tableToSkip.table }); // Use actual column names
    });
  }
  for (const columnToSkip of columnsToSkip) {
    columnQuery = columnQuery.whereNot(function() {
      this.where({
        'C.TABLE_SCHEMA': columnToSkip.database, // Use actual column names
        'C.TABLE_NAME': columnToSkip.table, // Use actual column names
        'C.COLUMN_NAME': columnToSkip.column, // Use actual column names
      });
    });
  }

  // Apply databasesToLimit to the base columnQuery before cloning
  if (!_.isEmpty(databasesToLimit)) {
    columnQuery = columnQuery.whereIn('C.TABLE_SCHEMA', databasesToLimit);
  }

  const columnQueryForProblem = columnQuery.clone()
    .join('information_schema.STATISTICS as S', function() {
      this.on('C.TABLE_SCHEMA', '=', 'S.TABLE_SCHEMA') // Use actual column names
        .andOn('C.TABLE_NAME', '=', 'S.TABLE_NAME') // Use actual column names
        .andOn('C.COLUMN_NAME', '=', 'S.COLUMN_NAME'); // Use actual column names
    })
    .where(function() {
      this.whereNull('S.SUB_PART') // Use actual column name
        .andWhere('C.CHARACTER_MAXIMUM_LENGTH', '>', 191); // Use actual column name
    })
    .orWhere('S.SUB_PART', '>', 191) // Use actual column name
    .orderBy('C.TABLE_SCHEMA', 'asc') // Use actual column name
    .orderBy('C.TABLE_NAME', 'asc') // Use actual column name
    .orderBy('S.INDEX_NAME', 'asc') // Use actual column name
    .columns( // Select uppercase column names
      'S.INDEX_NAME',
      'S.INDEX_TYPE',
      'C.TABLE_SCHEMA',
      'C.TABLE_NAME',
      'C.COLUMN_NAME',
      'C.DATA_TYPE',
      'C.CHARACTER_MAXIMUM_LENGTH',
      'S.SUB_PART');

  const columnsForProblem = await select(columnQueryForProblem);

  if (_.isEmpty(columnsForProblem)) {
    debug('No problem columns detected');
  } else {
    console.log('-- Problem columns (index prefix > 191 characters)');
    for (const column of columnsForProblem) {
      console.log(`--   \`${column.TABLE_SCHEMA}\`.\`${column.TABLE_NAME}\`.\`${column.COLUMN_NAME}\` (\`${column.INDEX_NAME}\` ${column.INDEX_TYPE} ${column.SUB_PART || column.CHARACTER_MAXIMUM_LENGTH})`);
    }
  }

  const columnQueryForConvert = columnQuery.clone()
    .columns( // Select uppercase column names
      'C.TABLE_SCHEMA',
      'C.TABLE_NAME',
      'C.COLUMN_NAME',
      'C.COLUMN_TYPE',
      'C.IS_NULLABLE');
  const columnsToConvert = await select(columnQueryForConvert);

  if (!options.bulkTable) {
    debug(`Altering ${columnsToConvert.length} columns`);
    for (const column of columnsToConvert) {
      await alter(`
        ALTER TABLE \`${column.TABLE_SCHEMA}\`.\`${column.TABLE_NAME}\`
        MODIFY \`${column.COLUMN_NAME}\` ${column.COLUMN_TYPE}
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_0900_ai_ci${column.IS_NULLABLE === 'NO' ? ' NOT NULL' : ''}`);
    }
  }

  await knex.destroy();
}

go()
  .then(() => {
    debug('done');
    process.exit(0);
  }, err => {
    console.error(err.stack);
    process.exit(1);
  });
