#!/bin/bash

echo -n "Creating folders... "

mkdir -p /app/config/keys
mkdir -p /app/data/secureconnection/.gnupg

echo " DONE"

echo -n "Copying over contents... "
cp -a /app/data/secureconnection/.gnupg /root/
echo " DONE"

echo "Generating key, supply your input please"
gpg --full-generate-key

echo -n "Copying over new .gnupg contents to data/secureconnection/.gnupg"
cp -a /root/.gnupg /app/data/secureconnection/

echo "Don't forget to mount data/secureconnection/.gnupg in the secureconnection service's /root/.gnupg"
echo ""
echo "enjoy!"
