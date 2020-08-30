#!/bin/bash

echo -n "Creating folders... "
mkdir -p /app/config/keys
mkdir -p /app/data/secureconnection/.gnupg
echo " DONE"

echo -n "Copying over contents... "
cp -a /app/data/secureconnection/.gnupg /root/
echo " DONE"

echo "Listing keys"

gpg --list-secret-keys

