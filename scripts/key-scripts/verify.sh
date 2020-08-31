#!/bin/bash

echo -n "Creating folders... "

mkdir -p /app/config/keys
mkdir -p /app/data/secureconnection/.gnupg

echo " DONE"

echo -n "Copying over contents... "
cp -a /app/data/secureconnection/.gnupg /root/
echo " DONE"

echo "Decrypting and verifying file... "
gpg --status-fd 1 --output /dev/null --decrypt /app/$1 2>/dev/null | grep -q '^\[GNUPG:\] GOODSIG .* <securerequester@redpencil\.io>'

echo "Exit code: $?"
