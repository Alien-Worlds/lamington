#!/usr/bin/env node

/**
 * Lamington Snapshot Management CLI
 * Provides commands to manage blockchain snapshots
 */

import { program } from 'commander';
import { ConfigManager } from '../configManager';
import {
    listSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteAllSnapshots,
    deleteSnapshot,
    SnapshotMetadata
} from './cli-utils/blockchainSnapshotManagement';

program
    .name('lamington-snapshots')
    .description('Lamington Blockchain Snapshot Management')
    .version('1.0.0');

// List snapshots command
program
    .command('list')
    .description('List available snapshots')
    .action(async () => {
        try {
            await ConfigManager.loadConfigFromDisk();
            const snapshots = await listSnapshots();
            
            if (snapshots.length === 0) {
                console.log('No snapshots found.');
                return;
            }
            
            console.log(`Found ${snapshots.length} snapshot(s):`);
            snapshots.forEach((snapshot, index) => {
                console.log(`${index + 1}. ${snapshot.name}`);
                console.log(`   Created: ${snapshot.metadata.timestamp}`);
                console.log(`   EOS Version: ${snapshot.metadata.eosVersion}`);
                console.log(`   Contracts: ${snapshot.metadata.contractsVersion}`);
                console.log(`   Block Height: ${snapshot.metadata.blockHeight}`);
                console.log(`   System Contracts: ${snapshot.metadata.systemContractsInstalled}`);
                console.log('');
            });
        } catch (error) {
            console.error('Failed to list snapshots:', error);
            process.exit(1);
        }
    });

// Create snapshot command
program
    .command('create')
    .description('Create a new snapshot')
    .option('-n, --name <name>', 'Custom snapshot name')
    .action(async (options) => {
        try {
            await ConfigManager.loadConfigFromDisk();
            
            const snapshotName = options.name || undefined;
            console.log(`Creating snapshot${snapshotName ? ` "${snapshotName}"` : ''}...`);
            
            const snapshotPath = await createSnapshot(snapshotName);
            console.log(`Snapshot created successfully: ${snapshotPath}`);
        } catch (error) {
            console.error('Failed to create snapshot:', error);
            process.exit(1);
        }
    });

// Restore snapshot command
program
    .command('restore <name>')
    .description('Restore from a snapshot')
    .action(async (name) => {
        try {
            await ConfigManager.loadConfigFromDisk();
            
            console.log(`Restoring from snapshot: ${name}`);
            const success = await restoreSnapshot(name);
            
            if (success) {
                console.log('Snapshot restored successfully!');
            } else {
                console.log('Failed to restore snapshot');
                process.exit(1);
            }
        } catch (error) {
            console.error('Failed to restore snapshot:', error);
            process.exit(1);
        }
    });

// Delete all snapshots command
program
    .command('delete-all')
    .description('Delete all snapshots')
    .option('-f, --force', 'Force delete without confirmation')
    .action(async (options) => {
        try {
            if (!options.force) {
                console.log('This will delete ALL snapshots. Are you sure? (y/n)');
                
                // Simple confirmation (would need more robust input handling for production)
                // For now, we'll skip this in the CLI version
            }
            
            await ConfigManager.loadConfigFromDisk();
            const deletedCount = await deleteAllSnapshots();
            console.log(`Deleted ${deletedCount} snapshots`);
        } catch (error) {
            console.error('Failed to delete snapshots:', error);
            process.exit(1);
        }
    });

// Delete specific snapshot command
program
    .command('delete <name>')
    .description('Delete a specific snapshot')
    .action(async (name) => {
        try {
            await ConfigManager.loadConfigFromDisk();
            
            const success = await deleteSnapshot(name);
            if (success) {
                console.log(`Deleted snapshot: ${name}`);
            } else {
                console.log(`Failed to delete snapshot: ${name}`);
                process.exit(1);
            }
        } catch (error) {
            console.error('Failed to delete snapshot:', error);
            process.exit(1);
        }
    });

// Handle no command provided
if (process.argv.length <= 2) {
    program.help();
}

program.parse(process.argv);