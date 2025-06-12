# utf8mb4-converter

An automated converter for mysql databases/tables/columns to a new charset/collation.


So, you thought ahead when setting up your [MySQL][] database and set your
character encoding to `utf8` to make it easier to store international characters
and actually read them back out again.

But then someone sets their name to an [emoji][], and it isn't being read back
properly from the database. A little bit of digging reveals that `utf8` on MySQL
is really [just a subset of the full UTF-8 character set][utf8mb3]. What you
really wanted was [utf8mb4][]. At this point, you have a few choices.

 1. Switch to [PostgreSQL][], [MongoDB][], or pretty much anything else
 2. Fix the charset and encoding in your MySQL database

## Switching to utf8mb4 (or another)

There are a number of resources for switching the character set and collation
for your MySQL databases, tables and columns. [The best write-up][full-unicode]
is by [Mathais][], but there's also [useful info][RDS] from [Alon Diamant][] if
you happen to be running in AWS.

**Please read everything you can before proceeding!!!** This script attempts to
safely and automagically convert `utf8`/`utf8mb3`(these are the same in mysql terms).  You can specify other datasets (ie latin1 if you are OK with losing any non-ascii chars) or others if you specify.  It may not work with all datasets but we use standard SQL alter commands so if mysql supports it it should not be different here. Backup before proceeding, run it in a test environment if you can.

Before proceeding:

 0. [Backup]. These scripts worked for me, but may cause you to lose all your
    data.
 1. Run it a few times in a test environment. Be sure this test environment is
    running the same version of MySQL; I've seen slightly different behaviors
    with different versions.
 2. Update MySQL configuration prior to migrating data, so that new
    tables/colums can be correctly encoded with `utf8mb4`.

## Installation

This app requires [Node.js][].

```
$ npm install -g https://github.com/mitchcapper/utf8mb4-converter.git
```

## Usage

```
$ utf8mb4-converter [OPTIONS...]
```

 0. You made a backup already, right?
 1. Run `utf8mb4-converter` and inspect the DDL it will execute to see what it
    is going to do to your database.
 2. If all looks good, you can either execute that generated script, or you can
    run `utf8mb4-converter --make-it-so` to execute the DDL on the server.

If you do not see any output when running it make sure you have databases/tables that would match.  IE if you had a database in a charset that is not one of the --from-charsets then even if you specify --limit [db] it will not print anything for that database.  Any limiters only further filter results.


## Options

### --from-charsets <charsets>

Comma-separated list of charsets to convert from. The default is `utf8,utf8mb3`. For example, to convert from `latin1` as well, use `--from-charsets utf8,utf8mb3,latin1`. **Note:** If you include `latin1`, be very sure your data only contains ASCII characters, as non-ASCII data may not convert properly.

### --charset-to <charset>

Target charset to convert to. The default is `utf8mb4`. For example, to convert to another charset, use `--charset-to utf8mb4` (or another supported charset).

### --collation <collation>

Collation to use for conversion. The default is `utf8mb4_0900_ai_ci`. You can specify another collation if needed.

### --skip [database[.table[.column]]]

If there are some databases, tables, or columns on your MySQL server you'd rather not convert, you can pass them to `--skip` to, well, skip them.

### --limit [database]

Limit conversion to the given database(s).

### --make-it-so

Execute DDL in addition to printing it out (actually performs the conversion).

### --bulk-table

Use `ALTER TABLE ... CONVERT TO CHARACTER SET` for each table rather than altering columns individually.

### --myisam-to-innodb

Convert all MyISAM tables to InnoDB before charset conversion.

### --verbose

If you'd like to see more of what the script is doing, pass in `--verbose`.

## Be Aware

InnoDB has an index length limit of 767 bytes per column by default. For `utf8mb3`, this
conveniently works out to 255 characters. But for `utf8mb4`, this is only 191
characters. If you have any columns longer than that, you will either have to
limit the index to 191 characters of the column, or narrow the column to 191
characters.   We do check for this and warn you if we find any columns that have this problem.  You can enable extended indexes in mysql if required to support longer column length indexes.

# LICENSE

ISC license. PRs welcome.

 [MySQL]: https://www.mysql.com/
 [emoji]: http://unicode.org/emoji/charts/full-emoji-list.html
 [utf8mb3]: https://dev.mysql.com/doc/refman/5.5/en/charset-unicode-utf8mb3.html
 [utf8mb4]: https://dev.mysql.com/doc/refman/5.5/en/charset-unicode-utf8mb4.html
 [PostgreSQL]: http://www.postgresql.org/
 [MongoDB]: https://www.mongodb.com/
 [full-unicode]: https://mathiasbynens.be/notes/mysql-utf8mb4
 [Mathais]: https://mathiasbynens.be/
 [RDS]: http://aprogrammers.blogspot.com/2014/12/utf8mb4-character-set-in-amazon-rds.html
 [Alon Diamant]: http://aprogrammers.blogspot.com/2014/12/utf8mb4-character-set-in-amazon-rds.html
 [Backup]: http://dev.mysql.com/doc/refman/5.7/en/backup-and-recovery.html
 [Node.js]: https://nodejs.org/en/
